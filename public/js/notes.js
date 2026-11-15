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

const noteByName = (name) => notes.find(n => n.name === name);
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
  $('noteContent')?.addEventListener('input', () => { scheduleSave(); renderNoteTags(); });
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
