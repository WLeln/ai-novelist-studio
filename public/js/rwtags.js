// ---------- リライトルールタグ（AZ[本文] / [AZ[...]XX[...]] をAIで一括書き換え） ----------
// 使い方:
//   AZ[人間大好きだよって]            → AZ に登録した指示で本文を書き換え
//   ZX[死神を殺しまくる,200]          → カンマ+数字で目標文字数を指定
//   ZX[...]XX[...]                    → 複数タグを連続して一括実行（Ctrl+Shift+X）
//   [ZX[...]XX[...]]                  → 角括弧で囲むと各結果を1つの文章に統合
//   AAA[私は人間,これに続く内容を筆記して,300] → 組み込み：対象テキストに指示を適用（第1引数=対象・第2引数=指示・末尾数字=文字数）
//   BBB[人間が殺しあう描写を筆記して,180]     → 組み込み：指示だけで文章を生成（第1引数=指示・末尾数字=文字数）
// タグは kind='rwtag' でサーバーDBに保存（バックアップ・タイムマシン対象）
import { $ } from './dom.js';
import { api, appAlert, appConfirm } from './util.js';
import { callApiOnce } from './context.js';
import { styleSampleBlock } from './state.js';

let rwTags = [];
let tagSet = new Set();
let getEditorFn = null;
let setStatusFn = null;
let running = false;
let inited = false;

export async function refreshRwTags() {
  rwTags = await api('/api/rwtags');
  tagSet = new Set(rwTags.map(t => t.code));
  return rwTags;
}

// ---------- 構文パーサ（プレーンテキスト走査） ----------
function codeAt(text, i) {
  // 組み込み3文字タグ（AAA=対象に指示適用 / BBB=指示で生成）
  const c3 = text.slice(i, i + 3).toUpperCase();
  if ((c3 === 'AAA' || c3 === 'BBB') && text[i + 3] === '[') return c3;
  if (text[i + 2] !== '[') return null;
  const c = text.slice(i, i + 2);
  if (!/^[A-Za-z]{2}$/.test(c)) return null;
  const code = c.toUpperCase();
  return tagSet.has(code) ? code : null;
}
// open = '[' の位置。対応する ']' を深さカウントで探す
function findClose(text, open) {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '[') depth++;
    else if (text[j] === ']') { depth--; if (!depth) return j; }
  }
  return -1;
}
// i 位置から式を1つパース。失敗時 null
function parseNode(text, i) {
  const code = codeAt(text, i);
  if (code) {
    const open = i + code.length;
    const close = findClose(text, open);
    if (close < 0) return null;
    let inner = text.slice(open + 1, close);
    let len = 0;
    const m = inner.match(/,\s*(\d{1,6})\s*$/);
    if (m) { len = parseInt(m[1], 10); inner = inner.slice(0, m.index); }
    return { type: 'expr', code, inner, len, start: i, end: close + 1 };
  }
  if (text[i] === '[') {
    // グループ: [ 式 式 ... ]（式と空白のみ許容。通常の括弧書きと誤認しないよう厳密に）
    const items = [];
    let j = i + 1;
    for (;;) {
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j >= text.length) return null;
      if (text[j] === ']') {
        if (!items.length) return null;
        return { type: 'group', items, start: i, end: j + 1 };
      }
      const child = parseNode(text, j);
      if (!child) return null;
      items.push(child);
      j = child.end;
    }
  }
  return null;
}
// トップレベルの式/グループを全て拾う
function findJobs(text) {
  const jobs = [];
  let i = 0;
  while (i < text.length) {
    const n = parseNode(text, i);
    if (n) { jobs.push(n); i = n.end; } else i++;
  }
  return jobs;
}

// ---------- TipTap doc → プレーンテキスト + 文字→doc位置マップ ----------
function buildIndex(editor) {
  const doc = editor.state.doc;
  let text = '', map = [], open = false;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (open) { text += '\n'; map.push(-1); } // ブロック境界（端点には使われない）
      open = true;
      return true;
    }
    if (!open) return true;
    if (node.isText) {
      for (let k = 0; k < node.text.length; k++) { text += node.text[k]; map.push(pos + k); }
      return false;
    }
    if (node.isLeaf && node.isInline) { // hardBreak 等 → 改行として扱う
      text += '\n'; map.push(pos);
      return false;
    }
    return true;
  });
  return { text, map };
}

// ---------- AI 実行 ----------
function cleanOut(t) {
  let s = (t || '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  return s;
}
async function rewriteExpr(node, fullText) {
  const tag = rwTags.find(t => t.code === node.code);
  const source = (node.inner || '').trim();
  if (!tag || !source) return { text: source, len: node.len };
  const before = fullText.slice(Math.max(0, node.start - 250), node.start).trim();
  const after = fullText.slice(node.end, node.end + 250).trim();
  const ctx = [before && `前: …${before}`, after && `後: ${after}…`].filter(Boolean).join('\n');
  const { text } = await callApiOnce([
    { role: 'system', content: 'あなたは小説の推敲者です。指示に従って対象テキストを書き換え、書き換え後の本文のみを出力してください。説明・前置き・注意書き・引用符・Markdown装飾は一切付けないでください。' },
    { role: 'user', content: [
      '【書き換え指示】\n' + tag.instruction,
      '【対象テキスト】\n' + source,
      ctx ? '【前後の文脈（参考・出力には含めない）】\n' + ctx : '',
      node.len ? `【文字数】約${node.len}字で生成してください` : '',
      styleSampleBlock() || ''
    ].filter(Boolean).join('\n\n') }
  ]);
  return { text: cleanOut(text), len: node.len };
}
// 組み込みタグ: AAA[対象,指示,長さ] = 対象に指示を適用 / BBB[指示,長さ] = 指示で生成
async function genExpr(node, fullText) {
  const inner = (node.inner || '').trim();
  let target = '', instr = '';
  if (node.code === 'AAA') {
    const ci = inner.indexOf(',');
    if (ci >= 0) { target = inner.slice(0, ci).trim(); instr = inner.slice(ci + 1).trim(); }
    else { target = inner; instr = 'この文章に続く内容を自然に筆記してください'; }
  } else {
    instr = inner;
  }
  if (!instr) return { text: target || inner, len: node.len };
  const before = fullText.slice(Math.max(0, node.start - 250), node.start).trim();
  const after = fullText.slice(node.end, node.end + 250).trim();
  const ctx = [before && `前: …${before}`, after && `後: ${after}…`].filter(Boolean).join('\n');
  const { text } = await callApiOnce([
    { role: 'system', content: node.code === 'AAA'
      ? 'あなたは小説家です。【対象テキスト】に【指示】を適用し、対象テキストを含む完成形の本文のみを出力してください。説明・前置き・注意書き・引用符・Markdown装飾は一切付けないでください。'
      : 'あなたは小説家です。【指示】に従って文章を執筆し、本文のみを出力してください。説明・前置き・注意書き・引用符・Markdown装飾は一切付けないでください。' },
    { role: 'user', content: [
      target ? '【対象テキスト】\n' + target : '',
      '【指示】\n' + instr,
      ctx ? '【前後の文脈（参考・出力には含めない）】\n' + ctx : '',
      node.len ? `【文字数】約${node.len}字で生成してください` : '',
      styleSampleBlock() || ''
    ].filter(Boolean).join('\n\n') }
  ]);
  return { text: cleanOut(text) || target || inner, len: node.len };
}
async function mergeParts(parts, totalLen) {
  if (parts.length === 1) return parts[0];
  const { text } = await callApiOnce([
    { role: 'system', content: 'あなたは小説の編集者です。複数の書き換え済みの文章断片を、前後の文脈に沿って1つの自然な文章に統合してください。各断片の要素は削らず、文として滑らかにつなげてください。出力は統合後の本文のみで、説明・前置きは付けないでください。' },
    { role: 'user', content: parts.map((p, i) => `【断片${i + 1}】\n${p}`).join('\n\n') +
      (totalLen ? `\n\n【文字数】全体で約${totalLen}字` : '') }
  ]);
  return cleanOut(text);
}
async function execNode(node, fullText) {
  if (node.type === 'expr') {
    if (node.code === 'AAA' || node.code === 'BBB') return genExpr(node, fullText);
    return rewriteExpr(node, fullText);
  }
  const parts = [];
  let totalLen = 0;
  for (const ch of node.items) {
    const r = await execNode(ch, fullText);
    if (!r || !r.text.trim()) return null;
    parts.push(r.text);
    totalLen += r.len || 0;
  }
  const merged = await mergeParts(parts, totalLen);
  return { text: merged, len: totalLen || undefined };
}

// ---------- ProseMirror 置換用ノード構築 ----------
function inlineNodes(schema, text) {
  const out = [];
  const segs = text.split('\n');
  segs.forEach((s, i) => {
    if (i > 0) out.push(schema.nodes.hardBreak.create());
    if (s) out.push(schema.text(s));
  });
  return out;
}
function blockNodes(schema, text) {
  return text.split(/\n{2,}/).map(part =>
    schema.nodes.paragraph.create(null, inlineNodes(schema, part)));
}

// ---------- 本体：ドキュメント全体のリライトタグを一括実行 ----------
export async function runDocRewrites() {
  const editor = getEditorFn && getEditorFn();
  if (!editor) return;
  if (running) { setStatusFn?.('リライト実行中です'); return; }
  running = true;
  try {
    try { await refreshRwTags(); } catch {} // 取得失敗時はキャッシュで続行
    const idx = buildIndex(editor);
    if (!rwTags.length && !/(?:AAA|BBB)\[/i.test(idx.text)) {
      setStatusFn?.('リライトルールが未登録です（「ルール」から登録 / AAA・BBBタグは登録不要）');
      return;
    }
    const docBefore = editor.state.doc; // AI実行中に本文が編集されたら位置がずれるので中止判定用
    const nodes = findJobs(idx.text);
    if (!nodes.length) {
      setStatusFn?.('リライトタグが見つかりません（例: AZ[本文] / [AZ[...]XX[...]]）');
      return;
    }
    const jobs = [];
    for (const n of nodes) {
      const from = idx.map[n.start], to = idx.map[n.end - 1] + 1;
      if (from == null || from < 0 || to == null || to < 0) continue;
      let multi = false;
      for (let k = n.start; k < n.end; k++) if (idx.map[k] < 0) { multi = true; break; }
      jobs.push({ ...n, from, to, multi });
    }
    if (!jobs.length) { setStatusFn?.('リライト対象を特定できませんでした'); return; }
    const results = new Array(jobs.length).fill(null);
    let fail = 0;
    for (let i = 0; i < jobs.length; i++) {
      setStatusFn?.(`リライト中… ${i + 1}/${jobs.length}件`);
      try {
        const r = await execNode(jobs[i], idx.text);
        if (r && r.text.trim()) results[i] = r.text; else fail++;
      } catch { fail++; }
    }
    if (editor.state.doc !== docBefore) {
      setStatusFn?.('リライト中に本文が変更されたため中止しました');
      return;
    }
    // 末尾から順に1トランザクションで置換（手前の位置がずれないように）
    const schema = editor.schema;
    const tr = editor.state.tr;
    const order = jobs.map((_, i) => i).sort((a, b) => jobs[b].from - jobs[a].from);
    let applied = 0;
    for (const i of order) {
      const r = results[i];
      if (r == null) continue;
      const job = jobs[i];
      if (!/\n{2,}/.test(r) && !job.multi) {
        const inl = inlineNodes(schema, r);
        if (!inl.length) continue;
        tr.replaceWith(job.from, job.to, inl);
      } else {
        const blocks = blockNodes(schema, r);
        if (!blocks.length) continue;
        const tmp = schema.topNodeType.create(null, blocks);
        tr.replace(job.from, job.to, tmp.slice(0, tmp.content.size));
      }
      applied++;
    }
    if (applied) editor.view.dispatch(tr);
    editor.commands.focus?.();
    setStatusFn?.(`リライト完了: ${applied}件を置換${fail ? `（失敗${fail}件はそのまま）` : ''}`);
  } finally {
    running = false;
  }
}

// ---------- リライトルール管理モーダル ----------
function renderRwTagList() {
  const el = $('rwTagList');
  if (!el) return;
  el.innerHTML = '';
  if (!rwTags.length) {
    el.innerHTML = '<p class="hint">ルールがありません。「新しいルール」で登録してください。</p>';
    return;
  }
  for (const t of rwTags) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.innerHTML = `<strong></strong> <span class="hint"></span>`;
    div.querySelector('strong').textContent = `${t.code}${t.label ? ' — ' + t.label : ''}`;
    div.querySelector('.hint').textContent = (t.instruction || '').slice(0, 80).replace(/\n/g, ' ');
    div.title = t.instruction || '';
    div.onclick = () => editRwTag(t);
    el.appendChild(div);
  }
}
function editRwTag(t) {
  $('rwTagForm').classList.remove('hidden');
  $('rwId').value = t.id;
  $('rwCode').value = t.code;
  $('rwLabel').value = t.label || '';
  $('rwInstruction').value = t.instruction || '';
  $('btnDeleteRwTag').classList.remove('hidden');
}
function resetRwTagForm() {
  $('rwTagForm').classList.add('hidden');
  $('rwId').value = ''; $('rwCode').value = ''; $('rwLabel').value = ''; $('rwInstruction').value = '';
  $('btnDeleteRwTag').classList.add('hidden');
}
export function openRwTagManager() {
  refreshRwTags().then(renderRwTagList).catch(() => {});
  $('rwTagModal').classList.remove('hidden');
}
export async function saveRwTag() {
  const code = ($('rwCode').value || '').trim().toUpperCase();
  const label = $('rwLabel').value.trim();
  const instruction = $('rwInstruction').value.trim();
  if (!/^[A-Z]{2}$/.test(code)) { appAlert('コードは英字2文字で入力してください（例: AZ）'); return; }
  if (!instruction) { appAlert('書き換え指示を入力してください'); return; }
  const dup = rwTags.find(t => t.code === code && t.id !== $('rwId').value);
  if (dup) { appAlert(`コード ${code} は既に使われています`); return; }
  const id = $('rwId').value;
  const body = { code, label, instruction };
  try {
    if (id) await api('/api/rwtags/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/rwtags', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    appAlert('保存失敗: ' + (e.message || e));
    return;
  }
  await refreshRwTags();
  renderRwTagList();
  resetRwTagForm();
}
export async function deleteRwTag() {
  const id = $('rwId').value;
  if (!id || !(await appConfirm('このルールを削除しますか？'))) return;
  await api('/api/rwtags/' + id, { method: 'DELETE' });
  await refreshRwTags();
  renderRwTagList();
  resetRwTagForm();
}

// ---------- 初期化（documents.js の initDocEditor から呼ぶ） ----------
export function initRewriteTags({ getEditor, setStatus } = {}) {
  getEditorFn = getEditor || getEditorFn;
  setStatusFn = setStatus || setStatusFn;
  if (inited) return;
  inited = true;
  $('btnCloseRwTags').onclick = () => $('rwTagModal').classList.add('hidden');
  $('rwTagModal').addEventListener('click', (e) => { if (e.target === $('rwTagModal')) $('rwTagModal').classList.add('hidden'); });
  $('btnNewRwTag').onclick = () => { $('rwTagForm').classList.remove('hidden'); $('rwId').value = ''; $('rwCode').value = ''; $('rwLabel').value = ''; $('rwInstruction').value = ''; $('btnDeleteRwTag').classList.add('hidden'); $('rwCode').focus(); };
  $('btnSaveRwTag').onclick = saveRwTag;
  $('btnCancelRwTag').onclick = resetRwTagForm;
  $('btnDeleteRwTag').onclick = deleteRwTag;
  // 実行ショートカット: Ctrl+Shift+X（ドキュメント表示中のみ）
  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'x') return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    const ed = getEditorFn && getEditorFn();
    if (!ed || $('docPane')?.classList.contains('hidden')) return;
    e.preventDefault();
    runDocRewrites();
  });
}
