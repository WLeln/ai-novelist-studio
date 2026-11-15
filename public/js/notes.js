// ---------- Notes（Zettelkasten型ノートIDE） ----------
// [[ノート名]] / [[ノート名|表示]] リンク、#タグ、被リンク一覧、カード/ソースへの昇格
import { $ } from './dom.js';
import { api, appAlert, appConfirm, esc, fmtDate } from './util.js';
import { activateTab, registerTabOpener, showNotesView, showChatView } from './conversations.js';

let notes = [];          // /api/notes の配列
let currentNote = null;  // 編集中ノート
let searchQuery = '';
let activeTag = '';
let saveTimer = null;
let dirty = false;

const noteByName = (name) => {
  const t = String(name || '').trim();
  return notes.find(n => (n.name || '').trim() === t);
};
const noteLinks = (content) => {
  const out = new Set();
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(content || ''))) out.add(m[1].trim());
  return [...out];
};
const noteTags = (content) => {
  const out = new Set();
  const re = /#([^\s#、。，．,.!?！？「」『』()（）\[\]]+)/g;
  let m;
  while ((m = re.exec(content || ''))) out.add(m[1]);
  return [...out];
};

export async function refreshNotes() {
  notes = await api('/api/notes');
  renderNoteList();
  if (currentNote) {
    const fresh = notes.find(n => n.id === currentNote.id);
    if (fresh) { currentNote = fresh; renderNoteLinks(); }
  }
}

function setStatus(msg) {
  const el = $('noteStatus');
  if (el) el.textContent = msg;
}

function filteredNotes() {
  const q = searchQuery.trim().toLowerCase();
  return notes
    .filter(n => {
      if (activeTag && !noteTags(n.content).includes(activeTag)) return false;
      if (!q) return true;
      return (n.name || '').toLowerCase().includes(q)
        || (n.content || '').toLowerCase().includes(q)
        || noteTags(n.content).some(t => t.includes(q));
    })
    .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
}

function renderNoteList() {
  const el = $('noteList');
  if (!el) return;
  const list = filteredNotes();
  const st = $('noteStats');
  if (st) st.textContent = `${notes.length}件` + (activeTag ? ` #${activeTag}` : '');
  if (!list.length) {
    el.innerHTML = '<div class="note-list-empty hint">ノートがありません</div>';
    return;
  }
  el.innerHTML = '';
  for (const n of list) {
    const tags = noteTags(n.content);
    const div = document.createElement('div');
    div.className = 'note-item' + (currentNote && currentNote.id === n.id ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'note-item-name';
    name.textContent = n.name || '無題';
    const meta = document.createElement('div');
    meta.className = 'note-item-meta hint';
    meta.textContent = fmtDate(n.updated || n.created) + (n.content ? ` ・ ${n.content.length}字` : '');
    div.appendChild(name);
    div.appendChild(meta);
    if (tags.length) {
      const tagRow = document.createElement('div');
      tagRow.className = 'note-item-tags';
      for (const t of tags.slice(0, 4)) {
        const chip = document.createElement('button');
        chip.className = 'note-tag' + (t === activeTag ? ' active' : '');
        chip.textContent = '#' + t;
        chip.onclick = (e) => { e.stopPropagation(); activeTag = activeTag === t ? '' : t; renderNoteList(); };
        tagRow.appendChild(chip);
      }
      div.appendChild(tagRow);
    }
    div.onclick = () => openNote(n.id);
    el.appendChild(div);
  }
}

function renderNoteTags() {
  const row = $('noteTagRow');
  if (!row) return;
  const tags = noteTags($('noteContent')?.value || '');
  row.innerHTML = '';
  for (const t of tags) {
    const chip = document.createElement('button');
    chip.className = 'note-tag';
    chip.textContent = '#' + t;
    chip.title = 'このタグで絞り込み';
    chip.onclick = () => { activeTag = activeTag === t ? '' : t; renderNoteList(); };
    row.appendChild(chip);
  }
}

function renderNoteLinks() {
  const box = $('noteLinks');
  const outEl = $('noteLinksOut');
  const inEl = $('noteLinksIn');
  if (!box || !currentNote) { box?.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const myName = currentNote.name;
  // 出ていくリンク
  outEl.innerHTML = '';
  const outs = noteLinks(currentNote.content);
  if (!outs.length) outEl.innerHTML = '<span class="hint">なし</span>';
  for (const target of outs) {
    const b = document.createElement('button');
    b.className = 'note-link-btn';
    const exists = !!noteByName(target);
    b.textContent = target + (exists ? '' : '（未作成）');
    b.disabled = !exists;
    b.onclick = () => { const n = noteByName(target); if (n) openNote(n.id); };
    outEl.appendChild(b);
  }
  // 被リンク
  inEl.innerHTML = '';
  const ins = notes.filter(n => n.id !== currentNote.id && noteLinks(n.content).includes(myName));
  if (!ins.length) inEl.innerHTML = '<span class="hint">なし</span>';
  for (const n of ins) {
    const b = document.createElement('button');
    b.className = 'note-link-btn';
    b.textContent = n.name || '無題';
    b.onclick = () => openNote(n.id);
    inEl.appendChild(b);
  }
}

function scheduleSave() {
  dirty = true;
  setStatus('編集中…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 800);
}

async function saveCurrent() {
  if (!currentNote || !dirty) return;
  const name = ($('noteName')?.value || '').trim() || '無題';
  const content = $('noteContent')?.value || '';
  try {
    const updated = await api('/api/notes/' + currentNote.id, {
      method: 'PUT',
      body: JSON.stringify({ name, content })
    });
    currentNote = updated;
    const idx = notes.findIndex(n => n.id === updated.id);
    if (idx >= 0) notes[idx] = updated; else notes.push(updated);
    dirty = false;
    setStatus('保存しました ' + fmtDate(Date.now()));
    renderNoteList();
    renderNoteLinks();
  } catch (e) {
    setStatus('保存失敗: ' + e.message);
  }
}

export async function openNote(id) {
  await saveCurrent();
  const n = notes.find(x => x.id === id);
  if (!n) return;
  currentNote = n;
  $('noteMain')?.classList.remove('hidden');
  $('noteEmpty')?.classList.add('hidden');
  $('noteName').value = n.name || '';
  $('noteContent').value = n.content || '';
  dirty = false;
  sug = null;
  sugEl()?.classList.add('hidden');
  setStatus('');
  renderNoteList();
  renderNoteTags();
  renderNoteLinks();
}

async function newNote() {
  await saveCurrent();
  try {
    const n = await api('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ name: '無題のノート', content: '' })
    });
    notes.push(n);
    await openNote(n.id);
    $('noteName')?.focus();
    $('noteName')?.select();
  } catch (e) { appAlert('作成失敗: ' + e.message); }
}

async function deleteNote() {
  if (!currentNote) return;
  if (!(await appConfirm(`「${currentNote.name}」を削除しますか？`))) return;
  clearTimeout(saveTimer); // 削除後に保存タイマーが発火して404にならないように
  dirty = false;
  await api('/api/notes/' + currentNote.id, { method: 'DELETE' });
  notes = notes.filter(n => n.id !== currentNote.id);
  currentNote = null;
  $('noteMain')?.classList.add('hidden');
  $('noteEmpty')?.classList.toggle('hidden', notes.length > 0);
  renderNoteList();
  setStatus('');
}

async function promoteToCard() {
  if (!currentNote) return;
  await saveCurrent();
  const n = currentNote;
  const body = n.name + '\n\n' + (n.content || '');
  try {
    await api('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ name: n.name, kind: 'term', content: body, tags: 'ノート由来' })
    });
    setStatus('カードに登録しました');
  } catch (e) { appAlert('カード化失敗: ' + e.message); }
}

async function promoteToSource() {
  if (!currentNote) return;
  await saveCurrent();
  const n = currentNote;
  try {
    await api('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ name: n.name, content: n.content || '' })
    });
    setStatus('ソースに登録しました');
  } catch (e) { appAlert('ソース登録失敗: ' + e.message); }
}

// ---------- 筆記特化型IME：[[リンク]]・#タグのオートコンプリート ----------
// textarea上で「[[」「#」を打つと候補ポップアップが出て、Tab/Enterで確定できる
let sug = null; // {kind:'link'|'tag', start, query, items, sel}

function sugEl() {
  let el = $('noteSuggest');
  if (!el) {
    el = document.createElement('div');
    el.id = 'noteSuggest';
    el.className = 'note-suggest hidden';
    $('noteMain')?.appendChild(el);
  }
  return el;
}

function allTags() {
  const s = new Set();
  for (const n of notes) for (const t of noteTags(n.content)) s.add(t);
  return [...s];
}

// キャレット位置の画面座標をミラーdivで計測
function caretXY(ta, pos) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  mirror.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'visibility:hidden', 'white-space:pre-wrap',
    'word-wrap:break-word', 'overflow-wrap:break-word',
    `width:${ta.clientWidth}px`, `font:${cs.font}`, `line-height:${cs.lineHeight}`,
    `letter-spacing:${cs.letterSpacing}`, `padding:${cs.padding}`, `border:${cs.border}`,
    `box-sizing:${cs.boxSizing}`, `tab-size:${cs.tabSize}`
  ].join(';');
  const pre = document.createTextNode(ta.value.slice(0, pos));
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(pre); mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const taRect = ta.getBoundingClientRect();
  const mRect = marker.getBoundingClientRect();
  const mr = mirror.getBoundingClientRect();
  mirror.remove();
  return {
    x: taRect.left + (mRect.left - mr.left) - ta.scrollLeft,
    y: taRect.top + (mRect.top - mr.top) - ta.scrollTop
  };
}

function detectSug(ta) {
  const pos = ta.selectionStart;
  if (ta.selectionEnd !== pos) return null;
  const before = ta.value.slice(0, pos);
  let m = before.match(/\[\[([^\[\]]*)$/);
  if (m) {
    const query = m[1];
    const items = [];
    const q = query.trim().toLowerCase();
    const exact = noteByName(query);
    const ranked = notes
      .filter(n => n.name && (!q || n.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        const ap = an.startsWith(q) ? 0 : 1, bp = bn.startsWith(q) ? 0 : 1;
        return ap - bp || an.localeCompare(bn, 'ja');
      })
      .slice(0, 8)
      .map(n => ({ label: n.name, insert: `[[${n.name}]]`, kind: 'note' }));
    items.push(...ranked);
    if (q && !exact) items.push({ label: `＋新規ノート「${query.trim()}」`, insert: null, kind: 'new', name: query.trim().replace(/[\[\]]/g, '') });
    if (!items.length && !q) items.push({ label: '（ノート名を入力）', disabled: true });
    return { kind: 'link', start: pos - m[0].length, query, items, sel: 0 };
  }
  m = before.match(/#([^\s#、。，．,.!?！？「」『』()（）\[\]]*)$/);
  if (m) {
    const query = m[1];
    const q = query.toLowerCase();
    const tags = allTags()
      .filter(t => !q || t.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .slice(0, 8)
      .map(t => ({ label: '#' + t, insert: '#' + t, kind: 'tag' }));
    return { kind: 'tag', start: pos - m[0].length, query, items: tags, sel: 0 };
  }
  return null;
}

function renderSug(ta) {
  const el = sugEl();
  if (!sug || !sug.items.length) { el.classList.add('hidden'); return; }
  el.innerHTML = '';
  sug.items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'note-suggest-item' + (i === sug.sel ? ' sel' : '') + (it.disabled ? ' disabled' : '');
    d.textContent = it.label;
    d.onmousedown = (e) => { e.preventDefault(); acceptSug(ta, i); }; // blurで消えないようmousedownで確定
    el.appendChild(d);
  });
  const { x, y } = caretXY(ta, ta.selectionStart);
  const mainRect = $('noteMain')?.getBoundingClientRect();
  let px = x, py = y + 4;
  if (mainRect) {
    px = Math.max(mainRect.left + 8, Math.min(px, mainRect.right - 240));
    py = Math.max(mainRect.top + 8, Math.min(py, mainRect.bottom - sug.items.length * 26 - 12));
  }
  el.style.left = px + 'px';
  el.style.top = py + 'px';
  el.classList.remove('hidden');
}

function updateSug(ta) {
  const next = detectSug(ta);
  if (!next) { sug = null; sugEl().classList.add('hidden'); return; }
  if (sug && sug.kind === next.kind && sug.start === next.start && sug.query === next.query) {
    next.sel = Math.min(sug.sel, next.items.length - 1);
  }
  sug = next;
  renderSug(ta);
}

async function acceptSug(ta, idx) {
  if (!sug) return;
  const it = sug.items[idx];
  if (!it || it.disabled) return;
  const pos = ta.selectionStart;
  let insertText = it.insert;
  if (it.kind === 'new') {
    try {
      const n = await api('/api/notes', { method: 'POST', body: JSON.stringify({ name: it.name.slice(0, 100), content: '' }) });
      notes.push(n);
      insertText = `[[${n.name}]]`;
    } catch { return; }
  }
  if (insertText == null) return;
  ta.setRangeText(insertText, sug.start, pos, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  sug = null;
  sugEl().classList.add('hidden');
  renderNoteList();
  renderNoteLinks();
}

function onSuggestKeydown(e) {
  const ta = $('noteContent');
  if (!ta || e.isComposing) return;
  if (!sug || sugEl().classList.contains('hidden')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    sug.sel = (sug.sel + d + sug.items.length) % sug.items.length;
    renderSug(ta);
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    acceptSug(ta, sug.sel);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    sug = null;
    sugEl().classList.add('hidden');
  }
}

export function showNotesViewEntry() {
  activateTab('note', 'main');
  showNotesView();
  refreshNotes().then(() => {
    if (!currentNote && notes.length) openNote(notes[0].id);
    else { renderNoteList(); $('noteEmpty')?.classList.toggle('hidden', notes.length > 0); }
  });
}

export function initNotes() {
  registerTabOpener('note', () => { showNotesView(); refreshNotes(); });
  $('btnNotes')?.addEventListener('click', showNotesViewEntry);
  $('btnNoteNew')?.addEventListener('click', newNote);
  $('btnNoteClose')?.addEventListener('click', () => { saveCurrent(); showChatView(); });
  $('btnNoteDelete')?.addEventListener('click', deleteNote);
  $('btnNoteCard')?.addEventListener('click', promoteToCard);
  $('btnNoteSource')?.addEventListener('click', promoteToSource);
  $('noteName')?.addEventListener('input', scheduleSave);
  $('noteContent')?.addEventListener('input', () => {
    scheduleSave();
    renderNoteTags();
    updateSug($('noteContent'));
  });
  $('noteContent')?.addEventListener('keydown', onSuggestKeydown);
  $('noteContent')?.addEventListener('click', () => updateSug($('noteContent')));
  $('noteContent')?.addEventListener('blur', () => setTimeout(() => { sug = null; sugEl().classList.add('hidden'); }, 150));
  $('noteSearch')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderNoteList();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && !$('notePane')?.classList.contains('hidden')) {
      e.preventDefault();
      saveCurrent();
    }
  });
  window.addEventListener('pagehide', () => { if (dirty) { clearTimeout(saveTimer); saveCurrent(); } });
}
