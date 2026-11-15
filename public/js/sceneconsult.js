// ---------- シーン相談：シーン別のAI Q&A（履歴はシーンに保存） ----------
import { $ } from './dom.js';
import { esc, fmtDate } from './util.js';
import { allCards, config, styleSampleBlock } from './state.js';
import { callApiOnce } from './context.js';
import { msScene, listManuscriptScenes, scheduleMsSave, msAppendAiText } from './manuscript.js';

const el = (id) => $(id);
let busy = false;

function relatedCards(text) {
  const named = allCards
    .filter(c => c.name && c.name.length >= 2 && text.includes(c.name))
    .slice(0, 8);
  const style = allCards.filter(c => c.kind === 'style').slice(0, 3);
  const seen = new Set();
  return [...named, ...style].filter(c => !seen.has(c.id) && seen.add(c.id));
}

function buildContext(sc) {
  const flat = listManuscriptScenes();
  const idx = flat.findIndex(x => x.id === sc.id);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const text = sc.content || '';
  const cards = relatedCards(text)
    .map(c => `【${c.name}】（${c.kind || '設定'}）\n${(c.content || '').slice(0, 400)}`)
    .join('\n\n')
    .slice(0, 6000);
  const notes = (sc.aiNotes || []).slice(-6)
    .map(n => `Q: ${n.q}\nA: ${String(n.a).slice(0, 300)}`)
    .join('\n\n');
  const plot = sc.plot ? `【プロットメモ】${sc.plot}` : '';
  const sample = styleSampleBlock();
  return [
    `【章・シーン】${flat[idx]?.chapter || ''} / ${sc.title || ''}`,
    plot,
    config?.stylePreset ? `【文体指定】${config.stylePreset}` : '',
    sample || '',
    prev ? `【直前のシーン「${prev.title}」末尾】\n${(prev.content || '').slice(-800)}` : '',
    `【このシーンの本文】\n${text.slice(-6000) || '（未執筆）'}`,
    next ? `【次のシーン「${next.title}」冒頭】\n${(next.content || '').slice(0, 300)}` : '',
    cards ? `【関連する設定・登場人物】\n${cards}` : '',
    notes ? `【これまでの相談（直近）】\n${notes}` : ''
  ].filter(Boolean).join('\n\n');
}

function renderLog() {
  const log = el('consultLog');
  if (!log) return;
  const sc = msScene();
  const notes = sc?.aiNotes || [];
  if (!notes.length) {
    log.innerHTML = '<p class="hint">まだ相談はありません。下の欄に質問を入力してください。</p>';
    return;
  }
  log.innerHTML = notes.map((n, i) => `
    <div class="consult-item">
      <div class="consult-q"><span class="hint">${fmtDate(n.ts)}</span> ${esc(n.q)}</div>
      <div class="consult-a">${esc(n.a)}</div>
      <div class="consult-btns">
        <button class="qb consult-apply" data-i="${i}">本文に反映</button>
        <button class="qb consult-card" data-i="${i}">カード化</button>
      </div>
    </div>`).join('');
  log.querySelectorAll('.consult-apply').forEach(b => {
    b.onclick = () => {
      const n = msScene()?.aiNotes?.[parseInt(b.dataset.i, 10)];
      if (!n) return;
      if (msAppendAiText(n.a)) {
        const st = el('consultStatus');
        if (st) { st.textContent = '回答を本文に追記しました'; setTimeout(() => { st.textContent = ''; }, 2500); }
      }
    };
  });
  log.querySelectorAll('.consult-card').forEach(b => {
    b.onclick = async () => {
      const n = msScene()?.aiNotes?.[parseInt(b.dataset.i, 10)];
      if (!n) return;
      const { openCardExtract } = await import('./cardextract.js');
      openCardExtract(`【質問】${n.q}\n\n【回答】\n${n.a}`, 'シーン相談の回答');
    };
  });
  log.scrollTop = log.scrollHeight;
}

async function ask() {
  const sc = msScene();
  const inp = el('consultInput');
  const q = (inp?.value || '').trim();
  if (!sc) { el('consultStatus') && (el('consultStatus').textContent = 'シーンを選択してください'); return; }
  if (!q) return;
  if (busy) return;
  busy = true;
  if (el('consultSend')) el('consultSend').disabled = true;
  const st = el('consultStatus');
  if (st) st.textContent = 'AIが回答中…';
  try {
    const { text } = await callApiOnce([
      { role: 'system', content: 'あなたは小説の編集者・相談相手です。提示されたシーン本文・前後文脈・設定カードを踏まえて質問に答えてください。回答は簡潔に、必要なら箇条書きで。本文の創作・代筆は求められない限り不要です。' },
      { role: 'user', content: `${buildContext(sc)}\n\n【質問】\n${q}` }
    ]);
    const a = (text || '').trim() || '（応答がありませんでした）';
    // 生成中にシーンが切り替わっていないか確認してから保存
    if (msScene()?.id === sc.id) {
      sc.aiNotes = sc.aiNotes || [];
      sc.aiNotes.push({ ts: Date.now(), q: q.slice(0, 4000), a: a.slice(0, 8000) });
      if (sc.aiNotes.length > 20) sc.aiNotes = sc.aiNotes.slice(-20);
      scheduleMsSave();
      if (inp) inp.value = '';
      renderLog();
    }
    if (st) st.textContent = '';
  } catch (e) {
    if (st) st.textContent = '失敗: ' + (e.message || e);
  } finally {
    busy = false;
    if (el('consultSend')) el('consultSend').disabled = false;
    inp?.focus();
  }
}

export function openConsult() {
  const sc = msScene();
  if (!sc) { return; }
  const flat = listManuscriptScenes().find(x => x.id === sc.id);
  const t = el('consultTitle');
  if (t) t.innerHTML = `<svg class="icon"><use href="#i-sparkle"/></svg> シーン相談：${esc(flat ? flat.chapter + ' / ' + sc.title : sc.title)}`;
  el('consultModal')?.classList.remove('hidden');
  renderLog();
  setTimeout(() => el('consultInput')?.focus(), 50);
}

export function initConsult() {
  el('btnMsConsult') && (el('btnMsConsult').onclick = openConsult);
  el('btnCloseConsult') && (el('btnCloseConsult').onclick = () => el('consultModal').classList.add('hidden'));
  el('consultModal')?.addEventListener('click', (e) => { if (e.target === el('consultModal')) el('consultModal').classList.add('hidden'); });
  el('consultSend') && (el('consultSend').onclick = ask);
  el('consultInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ask(); }
  });
}
