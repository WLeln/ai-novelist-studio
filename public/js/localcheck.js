// ---------- Local Check（ローカル校正：MeCab+UniDic形態素解析。AI不使用・トークン消費なし） ----------
// ツールメニュー「ローカル校正」から実行。原稿・ドキュメント・ソースをまとめて解析し、
// 表記ゆれ/多用語/文体差異/ルビ不一致/NGワードを検出する。
import { $ } from './dom.js';
import { api } from './util.js';
import { allDocs, allSources } from './state.js';
import { listManuscriptScenes } from './manuscript.js';

const stripHtml = (h) => String(h || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

const TYPE_LABEL = { scene: '原稿', doc: 'ドキュメント', source: 'ソース' };
const KIND_META = {
  yure:    { label: '表記ゆれ',   color: 'var(--danger,#e05555)' },
  ngword:  { label: 'NGワード',   color: 'var(--danger,#e05555)' },
  ruby:    { label: 'ルビ不一致', color: 'var(--danger,#e05555)' },
  overuse: { label: '多用語',     color: 'var(--warn,#d9a03f)' },
  style:   { label: '文体差異',   color: 'var(--accent,#5b8def)' }
};
const KIND_ORDER = ['yure', 'ngword', 'ruby', 'overuse', 'style'];

let lastResult = null;
let running = false;
let autoTimer = null;

async function collectItems() {
  const out = [];
  for (const s of listManuscriptScenes()) {
    out.push({ type: 'scene', id: s.id, label: `${s.chapter} / ${s.title}`, text: s.content || '' });
  }
  const docs = await Promise.all(allDocs.map(async (d) => {
    try {
      const f = await api('/api/documents/' + d.id);
      return { type: 'doc', id: f.id, label: f.title || '無題', text: stripHtml(f.content) };
    } catch { return null; }
  }));
  out.push(...docs.filter(Boolean));
  for (const s of allSources) {
    out.push({ type: 'source', id: s.id, label: s.name || '無題', text: s.content || '' });
  }
  return out.filter(i => (i.text || '').trim().length >= 10);
}

function jumpTo(it) {
  if (it.type === 'scene') window.__openScene?.(it.id);
  else if (it.type === 'doc') window.__openDocument?.(it.id);
  else if (it.type === 'source') window.__openSources?.();
  $('lcModal')?.classList.add('hidden');
}

function renderResult(res) {
  const box = $('lcResults');
  if (!box) return;
  if (!res.available) {
    box.innerHTML = `<p class="hint" style="padding:12px">形態素解析エンジン（MeCab+UniDic）が見つかりません。<br>セットアップ: <code>npm run setup:readability</code>（約200MBダウンロード）</p>`;
    return;
  }
  const findings = res.findings || [];
  const warn = findings.filter(f => f.severity === 'warn').length;
  const info = findings.length - warn;
  if (!findings.length) {
    box.innerHTML = `<p style="padding:12px">✓ 指摘事項はありませんでした（${res.items}テキストを形態素解析）</p>`;
    return;
  }
  let html = `<div class="cons-summary hint">${res.items}テキストを解析：要確認 ${warn}件 / 参考 ${info}件</div>`;
  for (const kind of KIND_ORDER) {
    const list = findings.filter(f => f.kind === kind);
    if (!list.length) continue;
    const meta = KIND_META[kind];
    html += `<div class="cons-group-title"><span style="color:${meta.color}">●</span> ${meta.label}（${list.length}）</div>`;
    for (const f of list.slice(0, 80)) {
      html += `<div class="sr-group cons-item" data-kind="${kind}">
        <div class="sr-head">
          <span class="sr-type">${f.severity === 'warn' ? '⚠' : '💡'}</span>
          <strong class="sr-title"></strong>
        </div>
        <div class="sr-snippet"></div>
        <div class="lc-items"></div>
      </div>`;
    }
    if (list.length > 80) html += `<p class="hint">…他 ${list.length - 80} 件</p>`;
  }
  box.innerHTML = html;
  // findingsをKIND_ORDER順（各kind最大80件＝描画数と一致）に平坦化して対応付け
  const flat = [];
  for (const kind of KIND_ORDER) for (const f of findings.filter(x => x.kind === kind).slice(0, 80)) flat.push(f);
  const els = box.querySelectorAll('.cons-item');
  flat.forEach((f, idx) => {
    const el = els[idx];
    if (!el) return;
    el.querySelector('.sr-title').textContent = f.title;
    el.querySelector('.sr-snippet').textContent = f.detail || '';
    const wrap = el.querySelector('.lc-items');
    for (const it of (f.items || []).slice(0, 5)) {
      const b = document.createElement('button');
      b.className = 'btn-ghost btn-sm lc-jump';
      b.textContent = `${TYPE_LABEL[it.type] || it.type}: ${it.label}`;
      b.onclick = () => jumpTo(it);
      wrap.appendChild(b);
    }
  });
}

async function runCheck({ silent = false } = {}) {
  if (running) return;
  running = true;
  try {
    const items = await collectItems();
    if (!items.length) {
      if (!silent) renderResult({ available: true, findings: [], items: 0 });
      return;
    }
    const res = await api('/api/localcheck', { method: 'POST', body: JSON.stringify({ items }) });
    lastResult = res;
    updateBadge(res);
    if (!silent || !$('lcModal')?.classList.contains('hidden')) renderResult(res);
  } catch (e) {
    if (!silent) renderResult({ available: false, reason: 'チェック失敗: ' + e.message, findings: [] });
  } finally {
    running = false;
  }
}

function updateBadge(res) {
  const badge = $('lcBadge');
  if (!badge) return;
  const warn = res && res.available ? (res.findings || []).filter(f => f.severity === 'warn').length : 0;
  badge.textContent = warn ? String(warn) : '';
  badge.classList.toggle('hidden', !warn);
}

// ---- 自動監視: 原稿保存後にデバウンスして再チェック ----
function scheduleAutoCheck() {
  if (localStorage.getItem('lc_auto') !== '1') return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => runCheck({ silent: true }), 8000);
}

export function openLocalCheck() {
  $('lcModal')?.classList.remove('hidden');
  const box = $('lcResults');
  if (box) box.innerHTML = '<p class="hint" style="padding:12px">解析中…（MeCab+UniDic・AI不使用）</p>';
  runCheck();
}

export function initLocalCheck() {
  $('miLocalCheck') && ($('miLocalCheck').onclick = openLocalCheck);
  $('btnLcRun') && ($('btnLcRun').onclick = () => runCheck());
  $('btnCloseLc') && ($('btnCloseLc').onclick = () => $('lcModal')?.classList.add('hidden'));
  $('lcModal') && $('lcModal').addEventListener('click', (e) => {
    if (e.target === $('lcModal')) $('lcModal').classList.add('hidden');
  });
  const auto = $('lcAuto');
  if (auto) {
    auto.checked = localStorage.getItem('lc_auto') === '1';
    auto.onchange = () => {
      localStorage.setItem('lc_auto', auto.checked ? '1' : '0');
      if (auto.checked) runCheck({ silent: true });
    };
  }
  // バッジ要素をメニュー項目に追加
  const mi = $('miLocalCheck');
  if (mi && !$('lcBadge')) {
    const b = document.createElement('span');
    b.id = 'lcBadge';
    b.className = 'lc-badge hidden';
    mi.appendChild(b);
  }
  // 原稿保存フック（manuscript.js の flushMsSave 成功時に呼ばれる）
  window.__onMsSaved = scheduleAutoCheck;
}
