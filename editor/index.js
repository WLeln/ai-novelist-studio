// リッチテキストエディタ（TipTap）のエントリ。esbuildで public/js/editor.bundle.js にバンドルする
import { Editor, Extension, Mark } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

const AssistKey = new PluginKey('writerAssist');

// カーソル直前の文字列がカード名（固有名詞）のプレフィックスに一致したら、
// 残りをゴーストテキストで表示し Tab で補完する
function computeSuggestion(state, getNames) {
  const { $head } = state.selection;
  if (!$head.parent || !$head.parent.isTextblock) return null;
  const blockStart = $head.start();
  const before = state.doc.textBetween(blockStart, $head.pos, ' ', ' ').slice(-30);
  if (before.trim().length < 2) return null;
  const names = (typeof getNames === 'function' ? getNames() : []) || [];
  let best = null;
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (n.length < 3) continue;
    const maxLen = Math.min(before.length, n.length - 1);
    for (let len = maxLen; len >= 2; len--) {
      const suf = before.slice(-len);
      if (n.startsWith(suf)) {
        const rest = n.slice(len);
        if (!rest) break;
        // より長く一致したもの・全体が短いものを優先
        const score = len * 1000 - n.length;
        if (!best || score > best.score) best = { remainder: rest, pos: $head.pos, score, name: n };
        break;
      }
    }
  }
  return best;
}

function makeGhostWidget(text) {
  const span = document.createElement('span');
  span.className = 'ghost-suggest';
  span.textContent = text;
  return span;
}

// カーソルが「CODE[]」または空の「CODE[]」の中にある時、その削除範囲を返す
function emptyTagRange(state, isTagCode) {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return null;
  const off = $from.parentOffset;
  const before = $from.parent.textBetween(0, off, ' ', ' ');
  const nextCh = off < $from.parent.content.size ? $from.parent.textBetween(off, off + 1, ' ', ' ') : '';
  const ok = (code, start) => {
    if (!isTagCode(code.toUpperCase())) return false;
    const prev = start > 0 ? before[start - 1] : '';
    return !/[A-Za-z0-9]/.test(prev);
  };
  // カーソルが ']' の直後: 末尾が CODE[]
  let m = before.match(/([A-Za-z]{2,3})\[\]$/);
  if (m && ok(m[1], before.length - m[0].length)) {
    return { from: $from.pos - 2, to: $from.pos };
  }
  // カーソルが空の [] の中: 末尾が CODE[ で直後が ']'
  m = before.match(/([A-Za-z]{2,3})\[$/);
  if (m && nextCh === ']' && ok(m[1], before.length - m[0].length)) {
    return { from: $from.pos - 1, to: $from.pos + 1 };
  }
  return null;
}

function WriterAssist(opts = {}) {
  return Extension.create({
    name: 'writerAssist',
    addOptions() {
      return { getNames: () => [], onSuggest: null, tagTail: null, isTagCode: null, canPair: null, ...opts };
    },
    addProseMirrorPlugins() {
      const o = this.options;
      let pairDirty = false, composing = false, pairTimer = null;
      // タグコード末尾なら [] を挿入（IME変換の確定を待つため遅延実行）
      const applyTagPair = (view) => {
        if (typeof o.tagTail !== 'function') return;
        if (typeof o.canPair === 'function' && !o.canPair()) return;
        if (composing) { scheduleTagPair(view); return; } // 変換確定を待ってリトライ
        const { state } = view;
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent.isTextblock) return;
        const start = Math.max($from.start(), $from.pos - 40);
        const before = state.doc.textBetween(start, $from.pos, ' ', ' ');
        if (!o.tagTail(before)) return;
        if (before.split('[').length > before.split(']').length) return; // ブラケット内は再ペアしない
        const pos = $from.pos;
        const next = $from.parent.textBetween($from.parentOffset, Math.min($from.parentOffset + 1, $from.parent.content.size), ' ', ' ');
        if (next.startsWith('[')) return;
        const tr = state.tr.insertText('[]', pos);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        view.dispatch(tr);
      };
      const scheduleTagPair = (view) => {
        if (pairTimer) clearTimeout(pairTimer);
        pairTimer = setTimeout(() => { pairTimer = null; applyTagPair(view); }, 60);
      };
      return [new Plugin({
        key: AssistKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old, oldState, newState) {
            // 変化がなければそのまま
            if (!tr.docChanged && !tr.selectionSet) return old.map(tr.mapping, newState.doc);
            const sug = computeSuggestion(newState, o.getNames);
            if (!sug) return DecorationSet.empty;
            const decos = [Decoration.widget(sug.pos, () => makeGhostWidget(sug.remainder), { side: 1, key: 'ghost' })];
            return DecorationSet.create(newState.doc, decos);
          }
        },
        appendTransaction(trs) {
          // 小さな文字入力を検知してフラグを立てるだけ。実際の [] 挿入は
          // view.update → setTimeout で行い、IME変換確定とのDOM競合を避ける
          pairDirty = false;
          if (typeof o.tagTail === 'function') {
            for (const tr of trs) {
              if (!tr.docChanged) continue;
              // 末尾ステップだけでなく全ステップを走査（IME確定は複数ステップになることがある）
              const hit = tr.steps.some(st => {
                if (!st.slice || !st.slice.content) return false;
                if (typeof st.from === 'number' && st.to - st.from > 10) return false; // 大きな範囲置換（setContent等）は除外
                const t = st.slice.content.textBetween(0, st.slice.content.size, '', '');
                return t.length > 0 && t.length <= 3;
              });
              // トランザクション発生時点でローディング中（setContent等）ならペア対象外
              if (hit && (typeof o.canPair !== 'function' || o.canPair())) { pairDirty = true; break; }
            }
          }
          return null;
        },
        props: {
          decorations(state) { return AssistKey.getState(state); },
          handleDOMEvents: {
            compositionstart() { composing = true; },
            compositionend() { composing = false; }
          },
          handleKeyDown(view, event) {
            // Backspace: 空の CODE[] をタグごと一括削除
            if (event.key === 'Backspace' && typeof o.isTagCode === 'function' && view.state.selection.empty) {
              const r = emptyTagRange(view.state, o.isTagCode);
              if (r) {
                event.preventDefault();
                view.dispatch(view.state.tr.delete(r.from, r.to).scrollIntoView());
                return true;
              }
            }
            if (event.key !== 'Tab') return false;
            if (!view.state.selection.empty) return false; // 範囲選択中は通常のTabに任せる
            const sug = computeSuggestion(view.state, o.getNames);
            if (!sug) return false;
            event.preventDefault();
            view.dispatch(view.state.tr.insertText(sug.remainder));
            view.focus();
            return true;
          }
        },
        view(editorView) {
          // サジェスト状態をUIに通知（デバウンス）
          let last = '';
          const notify = () => {
            const s = computeSuggestion(editorView.state, o.getNames);
            const cur = s ? s.remainder : '';
            if (cur !== last) { last = cur; if (o.onSuggest) o.onSuggest(s ? s.name : '', s ? s.remainder : ''); }
          };
          editorView.dom.addEventListener('keyup', notify);
          editorView.dom.addEventListener('click', notify);
          return {
            // undo/redo・ツールバー操作・setContent等でもサジェスト表示を更新
            update(view, prevState) {
              if (view.state.doc !== prevState.doc || view.state.selection !== prevState.selection) notify();
              if (pairDirty) { pairDirty = false; scheduleTagPair(view); }
            },
            destroy() {
              if (pairTimer) clearTimeout(pairTimer);
              editorView.dom.removeEventListener('keyup', notify);
              editorView.dom.removeEventListener('click', notify);
            }
          };
        }
      })];
    }
  });
}

// ---------- 日本語組版マーク：ルビ・傍点 ----------
const Ruby = Mark.create({
  name: 'ruby',
  addAttributes() {
    return {
      reading: {
        default: '',
        rendered: false, // HTML属性には出さず <rt> から復元する
        parseHTML: el => el.querySelector('rt')?.textContent || ''
      }
    };
  },
  parseHTML() {
    return [{ tag: 'ruby', contentElement: 'rb' }];
  },
  renderHTML({ mark }) {
    return ['ruby', {}, ['rb', {}, 0], ['rt', {}, mark.attrs.reading || '']];
  }
});

const EmphasisDots = Mark.create({
  name: 'emphasisDots',
  parseHTML() {
    return [{ tag: 'span.emphasis-dots' }];
  },
  renderHTML() {
    return ['span', { class: 'emphasis-dots' }, 0];
  }
});

function createEditor(el, { content = '', placeholder = '', onUpdate = null, getNames = null, onSuggest = null, tagTail = null, isTagCode = null, canPair = null } = {}) {
  const editor = new Editor({
    element: el,
    extensions: [
      // TipTap v3: StarterKit が Link/Underline/ListKeymap を内包するため個別importは不要
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: 'noopener noreferrer' }
        }
      }),
      Placeholder.configure({ placeholder }),
      Ruby,
      EmphasisDots,
      WriterAssist({ getNames: getNames || (() => []), onSuggest, tagTail, isTagCode, canPair })
    ],
    content,
    onUpdate: ({ editor }) => { if (onUpdate) onUpdate(editor); }
  });
  return editor;
}

window.DocEditor = { create: createEditor, Editor };
