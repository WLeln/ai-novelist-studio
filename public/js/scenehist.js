// ---------- シーン履歴：リビジョン一覧・差分・復元 ----------
import { $ } from './dom.js';
import { api, appConfirm, appAlert, esc, fmtDate } from './util.js';
import { msScene, listManuscriptScenes, msApplyContent } from './manuscript.js';

const el = (id) => $(id);
let currentRev = null; // {i, ts, content}
let histSceneId = null; // モーダルを開いた時点のシーン（開いた後の選択変更で対象がズレないよう固定）

// 簡易行差分：共通の先頭/末尾行を除いた中間部分を -/+ で表示（旧版→現在）
function renderDiff(oldText, newText) {
  const A = String(oldText || '').split('\n');
  const B = String(newText || '').split('\n');
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const CTX = 3;
  const parts = [];
  const ctxFrom = Math.max(0, pre - CTX);
  if (ctxFrom > 0) parts.push(`<div class="hist-diff-ctx">… ${ctxFrom}行（変更なし）</div>`);
  for (let i = ctxFrom; i < pre; i++) parts.push(`<div class="hist-diff-ctx"> ${esc(A[i])}</div>`);
  for (let i = pre; i < A.length - suf; i++) parts.push(`<div class="hist-diff-del">− ${esc(A[i])}</div>`);
  for (let i = pre; i < B.length - suf; i++) parts.push(`<div class="hist-diff-add">＋ ${esc(B[i])}</div>`);
  const ctxTo = Math.min(suf, CTX);
  if (suf > ctxTo) parts.push(`<div class="hist-diff-ctx">… ${suf - ctxTo}行（変更なし）</div>`);
  for (let i = A.length - ctxTo; i < A.length; i++) parts.push(`<div class="hist-diff-ctx"> ${esc(A[i])}</div>`);
  return parts.join('') || '<p class="hint">（差分なし）</p>';
}

async function loadList() {
  const sc = msScene();
  const list = el('histList');
  const det = el('histDetail');
  if (!sc || !list) return;
  histSceneId = sc.id;
  const flat = listManuscriptScenes().find(x => x.id === sc.id);
  const t = el('histTitle');
  if (t) t.innerHTML = `<svg class="icon"><use href="#i-refresh"/></svg> 履歴：${esc(flat ? flat.chapter + ' / ' + sc.title : sc.title)}`;
  try {
    const r = await api(`/api/scenehist/${encodeURIComponent(sc.id)}`);
    const revs = r.revs || [];
    if (det) det.innerHTML = '<p class="hint">左の履歴を選択すると、現在の本文との差分を表示します。</p>';
    currentRev = null;
    if (!revs.length) {
      list.innerHTML = '<p class="hint" style="padding:8px">まだ履歴がありません。本文を編集して保存すると自動で記録されます（最大20版）。</p>';
      return;
    }
    list.innerHTML = revs.slice().reverse().map(rv => `
      <div class="hist-item" data-i="${rv.i}">
        <div class="hist-item-meta hint">${fmtDate(rv.ts)} · ${rv.len.toLocaleString()}字</div>
        <div class="hist-item-prev">${esc(rv.preview || '（空）')}</div>
      </div>`).join('');
    list.querySelectorAll('.hist-item').forEach(item => {
      item.onclick = () => showRev(sc.id, parseInt(item.dataset.i, 10));
    });
  } catch (e) {
    list.innerHTML = `<p class="hint">読み込み失敗: ${esc(e.message || e)}</p>`;
  }
}

async function showRev(sceneId, idx) {
  const det = el('histDetail');
  if (!det) return;
  det.innerHTML = '<p class="hint">読み込み中…</p>';
  try {
    const r = await api(`/api/scenehist/${encodeURIComponent(sceneId)}/${idx}`);
    currentRev = { i: idx, ts: r.ts, content: r.content || '' };
    // msScene()は「現在選択中」のシーンを返すため、モーダル表示中に選択が変わると別シーンを指す。
    // 履歴対象のシーンIDで本文を引く
    const target = listManuscriptScenes().find(x => x.id === sceneId);
    const cur = target?.content || '';
    const changed = currentRev.content !== cur;
    det.innerHTML = `
      <div class="hist-detail-head">
        <span class="hint">${fmtDate(r.ts)} · ${(r.content || '').length.toLocaleString()}字${changed ? ' · 現在の本文との差分' : ' · 現在の本文と同一'}</span>
        ${changed ? '<button id="btnHistRestore" class="btn-primary btn-sm" style="margin-left:8px">この版に復元</button>' : ''}
      </div>
      <div class="tm-diff-pre" style="margin-top:8px">${renderDiff(currentRev.content, cur)}</div>`;
    const btn = el('btnHistRestore');
    if (btn) btn.onclick = async () => {
      const sel = msScene();
      if (!sel || sel.id !== sceneId) {
        appAlert('選択中のシーンが履歴対象と変わっています。対象シーンを選択し直してから復元してください');
        return;
      }
      if (!(await appConfirm(`シーン「${sel.title || ''}」を ${fmtDate(r.ts)} 時点の内容に戻しますか？\n（現在の内容は新しい履歴として自動記録されます）`))) return;
      if (msApplyContent(currentRev.content)) {
        appAlert('復元しました');
        loadList();
      }
    };
  } catch (e) {
    det.innerHTML = `<p class="hint">読み込み失敗: ${esc(e.message || e)}</p>`;
  }
}

export function openSceneHist() {
  const sc = msScene();
  if (!sc) { appAlert('シーンを選択してください'); return; }
  el('histModal')?.classList.remove('hidden');
  loadList();
}

export function initSceneHist() {
  el('btnMsHist') && (el('btnMsHist').onclick = openSceneHist);
  el('btnCloseHist') && (el('btnCloseHist').onclick = () => el('histModal').classList.add('hidden'));
  el('histModal')?.addEventListener('click', (e) => { if (e.target === el('histModal')) el('histModal').classList.add('hidden'); });
}
