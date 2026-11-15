// ---------- Tabゴースト補完：カーソル位置にAIの続きを薄字表示→Tabで確定 ----------
import { $ } from './dom.js';
import { config, styleSampleBlock, overusedWordBlock } from './state.js';
import { callApiOnce } from './context.js';
import { msCommitAiEdit, msScene } from './manuscript.js';

let ghostEl = null, taEl = null, wrapEl = null;
let suggestion = null;      // { text, start, end }
let timer = null, busy = false, lastCall = 0;
const MIN_INTERVAL = 5000;  // API呼び出しの最小間隔（連打・無駄撃ち防止）
const IDLE_MS = 1500;       // 入力停止後に提案を要求するまでの時間

function ensureDom() {
  taEl = $('msEditor');
  if (!taEl || ghostEl) return !!taEl;
  wrapEl = document.createElement('div');
  wrapEl.className = 'ms-editor-body';
  taEl.parentNode.insertBefore(wrapEl, taEl);
  wrapEl.appendChild(taEl);
  ghostEl = document.createElement('div');
  ghostEl.className = 'ms-ghost';
  ghostEl.setAttribute('aria-hidden', 'true');
  wrapEl.appendChild(ghostEl);
  return true;
}

function paneVisible() {
  return !$('manuscriptPane')?.classList.contains('hidden');
}

function hideGhost() {
  suggestion = null;
  if (ghostEl) ghostEl.innerHTML = '';
}

// テキストエリアと同じ位置・サイズ・フォントでゴースト層を合わせる
function syncGhostBox() {
  if (!ghostEl || !taEl || !wrapEl) return;
  const wr = wrapEl.getBoundingClientRect();
  const tr = taEl.getBoundingClientRect();
  ghostEl.style.left = (tr.left - wr.left) + 'px';
  ghostEl.style.top = (tr.top - wr.top) + 'px';
  ghostEl.style.width = tr.width + 'px';
  ghostEl.style.height = tr.height + 'px';
  ghostEl.scrollTop = taEl.scrollTop;
  ghostEl.scrollLeft = taEl.scrollLeft;
}

function renderGhost() {
  if (!suggestion || !ghostEl) { hideGhost(); return; }
  const pos = taEl.selectionStart;
  if (pos !== suggestion.start) { hideGhost(); return; } // カーソルが動いたら消す
  const v = taEl.value;
  ghostEl.innerHTML = '';
  const mk = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  ghostEl.appendChild(mk('gh-text', v.slice(0, suggestion.start)));
  ghostEl.appendChild(mk('gh-sug', suggestion.text));
  ghostEl.appendChild(mk('gh-text', v.slice(suggestion.end)));
  syncGhostBox();
}

async function requestSuggestion() {
  if (!ensureDom() || !paneVisible()) return;
  const v = taEl.value || '';
  const s = taEl.selectionStart, e = taEl.selectionEnd;
  if (e !== s) { hideGhost(); return; }          // 選択範囲があるときは出さない
  if (v.trim().length < 30) { hideGhost(); return; }
  if (busy || Date.now() - lastCall < MIN_INTERVAL) return;
  lastCall = Date.now();
  busy = true;
  try {
    const before = v.slice(Math.max(0, s - 1500), s);
    const after = v.slice(e, e + 300);
    const rep = overusedWordBlock(v);
    const style = (config?.stylePreset ? `【文体】${config.stylePreset}\n` : '') + (styleSampleBlock() ? styleSampleBlock() + '\n' : '') + (rep ? rep + '\n' : '');
    const { text } = await callApiOnce([
      { role: 'system', content: 'あなたは小説の続きを書く共著者です。与えられた本文の直後に続く文章を、1〜2文（40〜80字程度）だけ出力してください。説明・引用符・Markdown・改行は不要で、本文の続きだけを出力してください。' },
      { role: 'user', content: `${style}【本文（カーソルより前・末尾）】\n${before}\n\n【本文（カーソルより後・冒頭）】\n${after}\n\nカーソル位置の直後に続く文章を書いてください。` }
    ]);
    const sug = (text || '').trim().replace(/^[\s「『]+|[」』\s]+$/g, '');
    // カーソル位置・本文が生成中に変わっていないか確認
    if (!sug || taEl.value !== v || taEl.selectionStart !== s) return;
    // プログラム的なvalue書き換え（シーン切替・履歴復元等）はinputイベントを発火しないため、
    // 確定時にシーンIDと前後コンテキストを再検証するための情報を保持する
    suggestion = {
      text: sug, start: s, end: e,
      sceneId: msScene()?.id || null,
      vlen: v.length,
      ctxPre: v.slice(Math.max(0, s - 100), s),
      ctxPost: v.slice(e, Math.min(v.length, e + 100))
    };
    renderGhost();
    const st = $('msStatus');
    if (st && ghostEl.innerHTML) { st.textContent = 'TabでAIの続きが確定できます（Escで消去）'; setTimeout(() => { if (st.textContent.includes('TabでAI')) st.textContent = ''; }, 3000); }
  } catch { /* 失敗時は静かに諦める */ }
  finally { busy = false; }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(requestSuggestion, IDLE_MS);
}

function accept() {
  if (!suggestion) return false;
  const { text, start, end, sceneId, vlen, ctxPre, ctxPost } = suggestion;
  const cur = taEl.value || '';
  // シーン切替・本文のプログラム的変更（履歴復元・AI追記等）後の誤挿入を防ぐ
  if ((msScene()?.id || null) !== sceneId) { hideGhost(); return false; }
  if (cur.length !== vlen
    || taEl.selectionStart !== start || taEl.selectionEnd !== end
    || cur.slice(Math.max(0, start - 100), start) !== ctxPre
    || cur.slice(end, Math.min(cur.length, end + 100)) !== ctxPost) {
    hideGhost();
    return false;
  }
  // msCommitAiEdit 経由でAI出所（aiSnippets）にも記録される
  if (!msCommitAiEdit(start, end, text)) return false;
  // updateMsEditorでvalue再設定されるため、カーソルを挿入末尾に戻す
  const pos = start + text.length;
  taEl.setSelectionRange(pos, pos);
  taEl.focus();
  hideGhost();
  return true;
}

export function initGhostWrite() {
  if (!ensureDom()) return;
  taEl.addEventListener('input', () => {
    hideGhost();
    schedule();
  });
  // カーソル移動・クリックでゴースト位置がずれるので再描画or消去
  taEl.addEventListener('select', () => { if (suggestion) renderGhost(); });
  taEl.addEventListener('scroll', syncGhostBox);
  taEl.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      if (suggestion) renderGhost();
    }
  });
  taEl.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape' && suggestion) { e.preventDefault(); hideGhost(); }
    else if (e.key === 'Tab' && suggestion && !e.shiftKey) {
      e.preventDefault();
      accept();
    } else if (e.key === 'Tab' && suggestion && e.shiftKey) {
      hideGhost(); // Shift+Tabは通常のフォーカス移動に譲る
    }
  });
  window.addEventListener('resize', syncGhostBox);
  new ResizeObserver(syncGhostBox).observe(taEl);
}
