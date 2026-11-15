// ---------- Cards（設定カード管理・会話別ピッカー） ----------
import { $ } from './dom.js';
import { api, appConfirm, esc } from './util.js';
import { allCards, setAllCards, cardsVersion, setCardsVersion, current, CARD_KINDS, allSources } from './state.js';
import { saveConversation, conversations } from './conversations.js';
import { listManuscriptScenes } from './manuscript.js';

export async function refreshCards() {
  setAllCards(await api('/api/cards'));
  setCardsVersion(cardsVersion + 1);
}
export function openCardsModal(editCard = null) {
  refreshCards().then(renderCardList);
  const f = $('cardFilter');
  if (f) { f.value = ''; f.oninput = renderCardList; }
  $('cardsModal').classList.remove('hidden');
  if (editCard) fillCardForm(editCard);
  else resetCardForm();
}
function renderCardList() {
  const el = $('cardList');
  const q = (($('cardFilter') || {}).value || '').trim().toLowerCase();
  const shown = q
    ? allCards.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.content || '').toLowerCase().includes(q) ||
        (c.tags || '').toLowerCase().includes(q) ||
        (c.triggers || '').toLowerCase().includes(q))
    : allCards;
  el.innerHTML = '';
  if (!allCards.length) {
    el.innerHTML = '<p class="hint">カードがありません。「新しいカード」で作成してください。</p>';
    return;
  }
  const fws = allCards.filter(c => c.kind === 'foreshadow');
  if (fws.length) {
    const open = fws.filter(c => !c.resolved).length;
    const d = document.createElement('div');
    d.className = 'hint';
    d.style.padding = '4px 8px';
    d.textContent = `伏線トラッカー: 未回収 ${open}件 / 回収済 ${fws.length - open}件（原稿ペインの「伏線チェック」でAI提案できます）`;
    el.appendChild(d);
  }
  if (q && !shown.length) {
    el.innerHTML = '<p class="hint">「' + esc(q) + '」に一致するカードがありません</p>';
    return;
  }
  const useCountOf = (id) => conversations.filter(cv => (cv.cardIds || []).includes(id)).length;
  const maxUse = Math.max(1, ...shown.map(x => useCountOf(x.id)));
  for (const c of shown) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.innerHTML = `<span class="card-kind">${CARD_KINDS[c.kind] || c.kind}</span> <strong></strong> ${c.resolved ? '<span class="card-resolved">回収済</span>' : ''} <span class="hint"></span>`;
    div.querySelector('strong').textContent = c.name;
    const tagStr = String(c.tags || '').split(/[,、\s]+/).filter(Boolean).map(t => '#' + t).join(' ');
    const aliasStr = String(c.aliases || '').split(/[,、\s]+/).filter(Boolean).map(t => '別名:' + t).join(' ');
    const hint = (c.content || '').slice(0, 60).replace(/\n/g, ' ');
    const useCount = useCountOf(c.id);
    div.querySelector('.hint').textContent = (tagStr ? tagStr + ' ' : '') + (aliasStr ? aliasStr + ' ' : '') + (c.triggers ? `⚑${c.triggers} ` : '') + (useCount ? `📎${useCount}会話 ` : '') + hint;
    const bar = document.createElement('div');
    bar.className = 'card-usebar';
    bar.innerHTML = `<i style="width:${Math.round(useCount / maxUse * 100)}%"></i>`;
    bar.title = `${useCount}件の会話で使用中`;
    div.appendChild(bar);
    div.onclick = () => fillCardForm(c);
    el.appendChild(div);
  }
}
// ---------- 登場シーン逆引き（カード名・別名が本文に出るシーン/ソース一覧） ----------
function cardSearchTerms(c) {
  const terms = new Set();
  const add = (s) => { for (const t of String(s || '').split(/[,、\s]+/).filter(Boolean)) if (t.trim().length >= 2) terms.add(t.trim()); };
  if (c.name) terms.add(c.name.trim());
  add(c.aliases);
  add(c.triggers);
  return [...terms];
}
function findCardAppearances(c) {
  const terms = cardSearchTerms(c).map(t => t.toLowerCase());
  if (!terms.length) return [];
  const hits = [];
  const scan = (label, text, sceneId) => {
    const low = String(text || '').toLowerCase();
    if (!low) return;
    let total = 0;
    for (const t of terms) {
      let idx = 0;
      while ((idx = low.indexOf(t, idx)) >= 0) { total++; idx += t.length; }
    }
    if (total) hits.push({ label, count: total, sceneId });
  };
  for (const sc of listManuscriptScenes()) {
    scan(`${sc.chapter} / ${sc.title}`, sc.content, sc.id);
  }
  for (const s of allSources) {
    scan(`ソース「${s.name || s.title || ''}」`, s.content, null);
  }
  hits.sort((a, b) => b.count - a.count);
  return hits.slice(0, 30);
}
function renderCardScenes(c) {
  const box = $('cardScenes');
  if (!box) return;
  const hits = findCardAppearances(c);
  if (!hits.length) {
    box.textContent = '登場シーン: 見つかりません（カード名・別名が本文に出ていません）';
    return;
  }
  box.innerHTML = `登場 ${hits.length}件：`;
  hits.forEach((h, i) => {
    if (i) box.appendChild(document.createTextNode('、'));
    if (h.sceneId && window.__openScene) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = h.label + (h.count > 1 ? `(${h.count})` : '');
      a.style.cursor = 'pointer';
      a.onclick = (e) => { e.preventDefault(); window.__openScene(h.sceneId); $('cardsModal')?.classList.add('hidden'); };
      box.appendChild(a);
    } else {
      box.appendChild(document.createTextNode(h.label + (h.count > 1 ? `(${h.count})` : '')));
    }
  });
}
function fillCardForm(c) {
  $('cardEditForm').classList.remove('hidden');
  $('cId').value = c.id;
  $('cName').value = c.name;
  $('cKind').value = c.kind;
  $('cContent').value = c.content;
  $('cTriggers').value = c.triggers || '';
  $('cTags').value = c.tags || '';
  $('cAliases').value = c.aliases || '';
  $('cRelations').value = c.relations || '';
  $('cResolved').checked = c.resolved === true;
  $('btnDeleteCard').classList.remove('hidden');
  renderCardScenes(c);
}
export function resetCardForm() {
  $('cardEditForm').classList.add('hidden');
  $('cId').value = ''; $('cName').value = ''; $('cContent').value = ''; $('cTriggers').value = ''; $('cTags').value = '';
  $('cAliases').value = ''; $('cRelations').value = '';
  $('cResolved').checked = false;
  $('btnDeleteCard').classList.add('hidden');
  const cs = $('cardScenes'); if (cs) cs.textContent = '';
}
export async function saveCard() {
  const id = $('cId').value;
  const body = { name: $('cName').value, kind: $('cKind').value, content: $('cContent').value, resolved: $('cResolved').checked, triggers: $('cTriggers').value, tags: $('cTags').value, aliases: $('cAliases').value, relations: $('cRelations').value };
  if (id) await api('/api/cards/' + id, { method: 'PUT', body: JSON.stringify(body) });
  else await api('/api/cards', { method: 'POST', body: JSON.stringify(body) });
  await refreshCards();
  renderCardList();
  resetCardForm();
}
export async function deleteCard() {
  const id = $('cId').value;
  if (!id || !(await appConfirm('このカードを削除しますか？'))) return;
  await api('/api/cards/' + id, { method: 'DELETE' });
  await refreshCards();
  renderCardList();
  resetCardForm();
}

// ---------- Card picker (per conversation) ----------
export function openCardPicker() {
  if (!current) return;
  const el = $('cardPickList');
  el.innerHTML = '';
  if (!allCards.length) {
    el.innerHTML = '<p class="hint">カードがありません。先にサイドバーの「カード」で作成してください。</p>';
    return;
  }
  for (const c of allCards) {
    const label = document.createElement('label');
    label.className = 'pick-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (current.cardIds || []).includes(c.id);
    cb.dataset.id = c.id;
    label.appendChild(cb);
    const tagStr = String(c.tags || '').split(/[,、\s]+/).filter(Boolean).map(t => '#' + t).join(' ');
    label.appendChild(document.createTextNode(` [${CARD_KINDS[c.kind] || c.kind}] ${c.name}${tagStr ? ' ' + tagStr : ''}`));
    el.appendChild(label);
  }
  $('cardPickModal').classList.remove('hidden');
}
export function saveCardPick() {
  if (!current) return;
  current.cardIds = [...document.querySelectorAll('#cardPickList input:checked')].map(cb => cb.dataset.id);
  saveConversation().then(() => {
    $('btnCloseCardPick').click();
  });
}
