// ---------- AI応答→カード抽出：テキストから設定候補をAI抽出してカード化 ----------
import { $ } from './dom.js';
import { api, esc, appAlert } from './util.js';
import { allCards, CARD_KINDS } from './state.js';
import { callApiOnce } from './context.js';
import { refreshCards } from './cards.js';

const el = (id) => $(id);
let sourceText = '';
let candidates = [];

const KINDS = ['character', 'world', 'term', 'foreshadow', 'style'];

async function runExtract() {
  const st = el('extractStatus');
  const list = el('extractList');
  if (st) st.textContent = 'AIが候補を抽出中…';
  if (list) list.innerHTML = '';
  el('btnExtractSave')?.classList.add('hidden');
  try {
    const existing = allCards.map(c => c.name).filter(Boolean).join('、').slice(0, 3000);
    const { text } = await callApiOnce([
      { role: 'system', content: 'あなたは小説の設定管理者です。与えられた文章から、カード化すべき設定・知識を抽出してください。出力はJSON配列のみ。各要素: {"name":"名前","kind":"character|world|term|foreshadow|style","content":"設定内容（200字以内）","aliases":"別名・読み（カンマ区切り、なければ空）","relations":"関係（なければ空）"}。既存カードにある名前は除外。最大8件。文章に設定的な情報がなければ [] を返す。' },
      { role: 'user', content: `【既存カード（これらは除外）】\n${existing || '（なし）'}\n\n【抽出対象テキスト】\n${sourceText.slice(0, 12000)}` }
    ]);
    const raw = (text || '').trim();
    const m = raw.match(/\[[\s\S]*\]/);
    candidates = m ? JSON.parse(m[0]) : [];
    if (!Array.isArray(candidates)) candidates = [];
    candidates = candidates.filter(c => c && c.name && typeof c.name === 'string').slice(0, 8);
    if (!candidates.length) {
      if (st) st.textContent = 'カード化できる候補が見つかりませんでした';
      return;
    }
    if (st) st.textContent = `${candidates.length}件の候補が見つかりました。カード化するものを選んでください。`;
    renderCandidates();
    el('btnExtractSave')?.classList.remove('hidden');
  } catch (e) {
    if (st) st.textContent = '抽出失敗: ' + (e.message || e);
    // JSONでなくてもテキスト応答の場合はそのまま候補にしない
  }
}

function renderCandidates() {
  const list = el('extractList');
  if (!list) return;
  list.innerHTML = candidates.map((c, i) => {
    const kind = KINDS.includes(c.kind) ? c.kind : 'term';
    return `<label class="extract-item">
      <input type="checkbox" data-i="${i}" checked>
      <span class="card-kind">${CARD_KINDS[kind] || kind}</span>
      <span class="extract-name"></span>
      <span class="hint extract-desc"></span>
    </label>`;
  }).join('');
  list.querySelectorAll('.extract-item').forEach((row, i) => {
    const c = candidates[i];
    row.querySelector('.extract-name').textContent = c.name;
    row.querySelector('.extract-desc').textContent =
      (c.content || '').slice(0, 80) + (c.aliases ? ` ／別名:${c.aliases}` : '') + (c.relations ? ` ／関係:${c.relations}` : '');
  });
}

async function saveSelected() {
  const list = el('extractList');
  const checked = [...(list?.querySelectorAll('input:checked') || [])]
    .map(cb => candidates[parseInt(cb.dataset.i, 10)]).filter(Boolean);
  if (!checked.length) { appAlert('カード化する候補を選んでください'); return; }
  const st = el('extractStatus');
  if (st) st.textContent = 'カードを作成中…';
  let n = 0;
  for (const c of checked) {
    try {
      await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({
          name: String(c.name).slice(0, 100),
          kind: KINDS.includes(c.kind) ? c.kind : 'term',
          content: String(c.content || '').slice(0, 20000),
          aliases: String(c.aliases || '').slice(0, 500),
          relations: String(c.relations || '').slice(0, 2000),
          tags: 'AI抽出'
        })
      });
      n++;
    } catch {}
  }
  await refreshCards();
  if (st) st.textContent = `${n}件のカードを作成しました`;
  el('btnExtractSave')?.classList.add('hidden');
  el('btnExtractRun') && (el('btnExtractRun').textContent = '別のテキストで再抽出');
}

export function openCardExtract(text, srcLabel = '') {
  sourceText = String(text || '');
  candidates = [];
  if (!sourceText.trim()) { appAlert('抽出するテキストがありません'); return; }
  const src = el('extractSrc');
  if (src) src.textContent = `対象: ${srcLabel || 'テキスト'}（${sourceText.length.toLocaleString()}字）`;
  const st = el('extractStatus');
  if (st) st.textContent = '';
  const list = el('extractList');
  if (list) list.innerHTML = '<p class="hint">「AIで候補を抽出」を押すと、登場人物・世界観・用語などのカード候補を提案します。</p>';
  el('btnExtractSave')?.classList.add('hidden');
  const run = el('btnExtractRun');
  if (run) run.textContent = 'AIで候補を抽出';
  el('extractModal')?.classList.remove('hidden');
}

export function initCardExtract() {
  el('btnCloseExtract') && (el('btnCloseExtract').onclick = () => el('extractModal').classList.add('hidden'));
  el('extractModal')?.addEventListener('click', (e) => { if (e.target === el('extractModal')) el('extractModal').classList.add('hidden'); });
  el('btnExtractRun') && (el('btnExtractRun').onclick = runExtract);
  el('btnExtractSave') && (el('btnExtractSave').onclick = saveSelected);
}
