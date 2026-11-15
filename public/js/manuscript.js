// ---------- Manuscript（原稿ペイン） ----------
import { $ } from './dom.js';
import { api, appPrompt, appConfirm, appAlert, appDialog, downloadFile, showResultModal, esc } from './util.js';
import { allCards, current, config, styleSampleBlock } from './state.js';
import { callApiOnce } from './context.js';
import { Chart, registerables } from './vendor.bundle.js';
import { showChatView, activateTab, showEmptyChat, tabs as convTabs } from './conversations.js';

let manuscript = { title: '無題', chapters: [] };
let msSel = { chapterId: null, sceneId: null };
const msCollapsed = new Set((() => { try { return JSON.parse(localStorage.getItem('ms_collapsed') || '[]'); } catch { return []; } })());
function toggleMsCollapse(chId) {
  if (msCollapsed.has(chId)) msCollapsed.delete(chId); else msCollapsed.add(chId);
  localStorage.setItem('ms_collapsed', JSON.stringify([...msCollapsed]));
  renderMsTree();
}
let msSaveTimer = null;
const msUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function loadManuscript() {
  try { manuscript = await api('/api/manuscript'); }
  catch { manuscript = { title: '無題', chapters: [] }; }
  if (!Array.isArray(manuscript.chapters)) manuscript.chapters = [];
  msSel.chapterId = manuscript.chapters[0]?.id || null;
  msSel.sceneId = manuscript.chapters[0]?.scenes[0]?.id || null;
  const goalEl = $('msGoal');
  if (goalEl) goalEl.value = manuscript.goal || '';
  renderMsTree();
  updateMsEditor();
  renderMsPins();
}

// ---------- 執筆統計 ----------
function msTotalChars() {
  let n = 0;
  for (const ch of manuscript.chapters) for (const sc of ch.scenes) n += (sc.content || '').length;
  return n;
}
export function updateMsStats() {
  const el = $('msStats');
  if (!el) return;
  const total = msTotalChars();
  const goal = parseInt(manuscript.goal, 10) || 0;
  const today = new Date().toISOString().slice(0, 10);
  manuscript._stats = manuscript._stats || { date: '', dayChars: 0, totalChars: 0, days: {} };
  manuscript._stats.days = manuscript._stats.days || {};
  if (manuscript._stats.date !== today) {
    manuscript._stats.date = today;
    manuscript._stats.dayChars = 0;
  }
  const diff = total - (manuscript._stats.totalChars || 0);
  if (diff > 0) manuscript._stats.dayChars += diff;
  manuscript._stats.totalChars = total;
  manuscript._stats.days[today] = manuscript._stats.dayChars;
  // 90日より古い履歴は削除
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(manuscript._stats.days)) {
    if (d < cutoff) delete manuscript._stats.days[d];
  }
  const pct = goal ? Math.min(100, Math.round(total / goal * 100)) : 0;
  el.textContent = `総計 ${total.toLocaleString()}字`
    + (goal ? ` / 目標 ${goal.toLocaleString()}字 (${pct}%)` : '')
    + ` · 本日 +${manuscript._stats.dayChars.toLocaleString()}字`;
  const bar = $('msProgressBar');
  if (bar) {
    bar.style.width = goal ? pct + '%' : '0%';
    bar.parentElement.style.display = goal ? '' : 'none';
  }
}
export function msSetGoal(v) {
  manuscript.goal = String(v || '').trim();
  updateMsStats();
  scheduleMsSave();
}

// ---------- 執筆グラフ（chart.js） ----------
let chartRegistered = false;
let msChart = null;
export function openWritingChart() {
  const days = manuscript._stats?.days || {};
  const labels = Object.keys(days).sort().slice(-30);
  if (!labels.length) { appAlert('まだグラフにできる執筆データがありません'); return; }
  showResultModal('日別の執筆文字数（直近' + labels.length + '日）', '<canvas id="msChartCanvas" height="240"></canvas>');
  const canvas = $('msChartCanvas');
  if (!canvas) return;
  if (!chartRegistered) {
    Chart.register(...registerables);
    chartRegistered = true;
  }
  if (msChart) { msChart.destroy(); msChart = null; }
  msChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels.map(d => d.slice(5)),
      datasets: [{
        label: '文字数',
        data: labels.map(d => days[d]),
        backgroundColor: 'rgba(0,0,0,.35)',
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: 'rgba(128,128,128,.15)' } },
        x: { ticks: { color: '#888', maxRotation: 60 }, grid: { display: false } },
      },
    },
  });
}
// ---------- 章別文字数グラフ ----------
export function openChapterChart() {
  const rows = manuscript.chapters
    .map(ch => ({
      title: ch.title,
      chars: ch.scenes.reduce((a, s) => a + (s.content || '').length, 0)
    }))
    .filter(r => r.chars > 0);
  if (!rows.length) { appAlert('まだ文字数データがありません'); return; }
  showResultModal('章別の文字数', '<canvas id="msChChart" height="240"></canvas>');
  const canvas = $('msChChart');
  if (!canvas) return;
  if (!chartRegistered) { Chart.register(...registerables); chartRegistered = true; }
  if (msChart) { msChart.destroy(); msChart = null; }
  msChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.title.length > 10 ? r.title.slice(0, 9) + '…' : r.title),
      datasets: [{
        label: '文字数',
        data: rows.map(r => r.chars),
        backgroundColor: 'rgba(74,127,212,.55)',
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: 'rgba(128,128,128,.15)' } },
        x: { ticks: { color: '#888', maxRotation: 60 }, grid: { display: false } },
      },
    },
  });
}
function scheduleMsSave() {
  clearTimeout(msSaveTimer);
  msSaveTimer = setTimeout(flushMsSave, 600);
}
function flushMsSave() {
  clearTimeout(msSaveTimer);
  msSaveTimer = null;
  api('/api/manuscript', { method: 'PUT', body: JSON.stringify(manuscript) })
    .catch(() => { const el = $('msStatus'); if (el) el.textContent = '原稿の保存に失敗しました'; });
}
// タブを閉じる・バックグラウンド化する直前にデバウンス分を確定保存
window.addEventListener('pagehide', flushMsSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMsSave(); });
export { scheduleMsSave };
function msChapter() { return manuscript.chapters.find(c => c.id === msSel.chapterId); }
export function msScene() {
  const ch = msChapter();
  return ch ? ch.scenes.find(s => s.id === msSel.sceneId) : null;
}
// ID指定でシーンオブジェクトを取得（モーダル等で選択が変わっても対象を固定するため）
export function msSceneById(id) {
  for (const ch of manuscript.chapters) {
    const sc = ch.scenes.find(s => s.id === id);
    if (sc) return sc;
  }
  return null;
}

// ---------- シーン一覧・シーン紐付け ----------
export function listManuscriptScenes() {
  const out = [];
  for (const ch of manuscript.chapters) {
    for (const sc of ch.scenes) {
      out.push({ id: sc.id, title: sc.title, chapter: ch.title, content: sc.content || '', plot: sc.plot || '' });
    }
  }
  return out;
}
// 会話に紐付いたシーン（current.sceneId）を解決
export function resolveLinkedScene() {
  const sid = current?.sceneId;
  if (!sid) return null;
  for (const ch of manuscript.chapters) {
    const sc = ch.scenes.find(s => s.id === sid);
    if (sc) return { scene: sc, chapter: ch };
  }
  return null;
}
// システムプロンプト用：紐付きシーンの情報（末尾1200字）
export function linkedSceneContext() {
  const r = resolveLinkedScene();
  if (!r) return null;
  const tail = (r.scene.content || '').trim().slice(-1200);
  return { chapterTitle: r.chapter.title, title: r.scene.title, tail };
}
// 原稿ペインを前面に出す。doc/graph/noteビューからのジャンプ時は
// チャットビュー＋会話タブに戻さないとペインが混在しタブ状態も壊れる
export function msRevealPane() {
  showChatView();
  if (current) activateTab('conv', current.id);
  else {
    const t = convTabs.find(t => t.type === 'conv');
    if (t) activateTab('conv', t.id); else showEmptyChat();
  }
  $('manuscriptPane')?.classList.remove('hidden');
  $('qbManuscript')?.classList.add('active');
}

// 検索結果からのジャンプ用：シーンを選択して原稿ペインを開く
window.__openScene = (sceneId) => {
  for (const ch of manuscript.chapters) {
    if (ch.scenes.some(s => s.id === sceneId)) {
      msSel.chapterId = ch.id; msSel.sceneId = sceneId;
      renderMsTree(); updateMsEditor();
      msRevealPane();
      return true;
    }
  }
  return false;
};

// プロファイルパネルの選択肢生成用（循環import回避でwindow経由）
window.__msScenes = () => listManuscriptScenes().map(s => ({ id: s.id, label: `${s.chapter} / ${s.title}` }));
function renderMsTree() {
  const el = $('msTree');
  if (!el) return;
  updateMsStats();
  el.innerHTML = '';
  if (!manuscript.chapters.length) {
    el.innerHTML = '<p class="hint" style="padding:8px">まだ章がありません。「＋章」で作成するか、AI応答の「原稿」ボタンで自動作成できます。</p>';
    return;
  }
  for (const ch of manuscript.chapters) {
    const chEl = document.createElement('div');
    chEl.className = 'ms-ch' + (ch.id === msSel.chapterId ? ' sel' : '');
    chEl.textContent = ch.title;
    const chChars = ch.scenes.reduce((a, s) => a + (s.content || '').length, 0);
    const chCnt = document.createElement('span');
    chCnt.className = 'ms-ch-count';
    chCnt.textContent = chChars ? chChars.toLocaleString() + '字' : '';
    chEl.appendChild(chCnt);
    const collapsed = msCollapsed.has(ch.id);
    const caret = document.createElement('span');
    caret.className = 'ms-caret';
    caret.textContent = collapsed ? '▸' : '▾';
    caret.title = collapsed ? '展開' : '折りたたむ';
    caret.onclick = (e) => { e.stopPropagation(); toggleMsCollapse(ch.id); };
    chEl.insertBefore(caret, chEl.firstChild);
    const mkChMv = (dir, label) => {
      const b = document.createElement('span');
      b.className = 'ms-mv';
      b.textContent = label;
      b.title = dir < 0 ? '章を上へ' : '章を下へ';
      b.onclick = (ev) => { ev.stopPropagation(); msMoveChapter(ch, dir); };
      return b;
    };
    chEl.appendChild(mkChMv(-1, '⇈'));
    chEl.appendChild(mkChMv(1, '⇊'));
    chEl.onclick = () => {
      msSel.chapterId = ch.id;
      msSel.sceneId = ch.scenes[0]?.id || null;
      renderMsTree(); updateMsEditor();
    };
    el.appendChild(chEl);
    if (collapsed) continue;
    for (const sc of ch.scenes) {
      const scEl = document.createElement('div');
      scEl.className = 'ms-sc' + (sc.id === msSel.sceneId ? ' sel' : '');
      const cnt = document.createElement('span');
      const scLen = (sc.content || '').length;
      cnt.className = 'ms-count' + (scLen >= 8000 ? ' heat3' : scLen >= 2000 ? ' heat2' : '');
      cnt.textContent = sc.content ? `${sc.content.length}字` : '';
      if (sc.aiSnippets?.length) {
        const badge = document.createElement('span');
        badge.className = 'ms-ai-badge';
        badge.textContent = 'AI';
        badge.title = `AI生成テキスト ${sc.aiSnippets.length}件`;
        scEl.appendChild(badge);
      }
      if (sc.aiNotes?.length) {
        const q = document.createElement('span');
        q.className = 'ms-ai-badge ms-q-badge';
        q.textContent = 'Q' + sc.aiNotes.length;
        q.title = `シーン相談 ${sc.aiNotes.length}件`;
        scEl.appendChild(q);
      }
      scEl.appendChild(document.createTextNode(sc.title));
      scEl.appendChild(cnt);
      const mkMv = (dir, label) => {
        const b = document.createElement('span');
        b.className = 'ms-mv';
        b.textContent = label;
        b.title = dir < 0 ? '上へ移動' : '下へ移動';
        b.onclick = (ev) => { ev.stopPropagation(); msMoveScene(ch, sc, dir); };
        return b;
      };
      scEl.appendChild(mkMv(-1, '↑'));
      scEl.appendChild(mkMv(1, '↓'));
      scEl.onclick = () => { msSel.chapterId = ch.id; msSel.sceneId = sc.id; renderMsTree(); updateMsEditor(); };
      el.appendChild(scEl);
    }
  }
}

// ---------- 伏線チェック ----------
export async function msForeshadowCheck() {
  const fws = allCards.filter(c => c.kind === 'foreshadow');
  if (!fws.length) {
    appAlert('伏線カードがありません。カード管理で種別「伏線」のカードを作成してください。');
    return;
  }
  const sc = msScene();
  const sceneText = sc
    ? `【対象シーン】${sc.title}\n${(sc.content || '').slice(0, 4000)}`
    : '（シーンが未選択です。伏線の全体状況を整理してください）';
  const list = fws.map(c =>
    `- ${c.name}${c.resolved ? '（回収済）' : '（未回収）'}: ${(c.content || '').slice(0, 200)}`
  ).join('\n');
  try {
    const { text } = await callApiOnce([
      { role: 'system', content: 'あなたは小説の編集者です。伏線カードの一覧と現在のシーンを読み、未回収の伏線のうちこのシーンで回収・匂わせるべきものを提案してください。各伏線について、回収の仕方の具体案を1〜2文で箇条書きにしてください。' },
      { role: 'user', content: `【伏線カード】\n${list}\n\n${sceneText}` }
    ]);
    await appDialog(`伏線チェック結果\n\n${(text || '').slice(0, 3000) || '（応答がありませんでした）'}`, { okText: '閉じる' });
  } catch (e) {
    appAlert('伏線チェックに失敗しました: ' + (e.message || e));
  }
}
function updateMsEditor() {
  const sc = msScene();
  $('msSceneTitle').value = sc ? sc.title : '';
  const pm = $('msPlotMemo');
  if (pm) pm.value = sc ? (sc.plot || '') : '';
  $('msEditor').value = sc ? sc.content : '';
  clearTimeout(rdTimer);
  $('msReadability')?.classList.add('hidden');
}

// ---------- リアルタイム読みやすさゲージ ----------
let rdTimer = null, rdSeq = 0;
async function runReadability() {
  const ta = $('msEditor');
  const g = $('msReadability');
  if (!ta || !g) return;
  const text = ta.value || '';
  if (text.trim().length < 30) { g.classList.add('hidden'); return; }
  const seq = ++rdSeq;
  try {
    const r = await api('/api/readability', { method: 'POST', body: JSON.stringify({ text: text.slice(0, 20000) }) });
    if (seq !== rdSeq || !$('msEditor')) return;
    const s = r.score;
    const label = s >= 5 ? '読みやすい' : s >= 4 ? 'やや読みやすい' : s >= 3 ? '普通' : '難しめ';
    g.textContent = `読みやすさ ${s.toFixed(1)}（${label}）`;
    g.className = 'ms-readability ' + (s >= 4 ? 'good' : s >= 3 ? 'mid' : 'low');
    g.title = (r.approx ? '近似計算' : 'jReadability実測') + ' / 平均文長 ' + (r.metrics?.avgSentenceLen ?? '—') + '字';
  } catch { /* 計測失敗時は非表示のまま */ }
}
export function initReadability() {
  const ta = $('msEditor');
  if (!ta) return;
  ta.addEventListener('input', () => {
    clearTimeout(rdTimer);
    rdTimer = setTimeout(runReadability, 1200);
  });
}
export function toggleManuscriptPane() {
  const pane = $('manuscriptPane');
  pane.classList.toggle('hidden');
  $('qbManuscript')?.classList.toggle('active', !pane.classList.contains('hidden'));
}

// ---------- 縦書きプレビュー ----------
export function toggleMsVertical() {
  const pane = $('manuscriptPane');
  const on = pane.classList.toggle('ms-vertical');
  localStorage.setItem('ms_vertical', on ? '1' : '0');
  $('btnMsVertical')?.classList.toggle('active', on);
}
export function restoreMsVertical() {
  if (localStorage.getItem('ms_vertical') === '1') {
    $('manuscriptPane')?.classList.add('ms-vertical');
    $('btnMsVertical')?.classList.add('active');
  }
}
export function adoptToManuscript(text, opts = {}) {
  const { openPane = true, newScene = false } = opts;
  const t = (text || '').trim();
  if (!t) return;
  if (!manuscript.chapters.length) {
    manuscript.chapters.push({ id: msUid(), title: '第1章', scenes: [] });
  }
  // 会話に対象シーンが紐付いていればそこへ追加（選択も同期）
  const linked = resolveLinkedScene();
  if (linked) {
    msSel.chapterId = linked.chapter.id;
    msSel.sceneId = linked.scene.id;
  }
  let ch = msChapter() || manuscript.chapters[0];
  msSel.chapterId = ch.id;
  if (newScene || !ch.scenes.length || !ch.scenes.some(s => s.id === msSel.sceneId)) {
    const sc = { id: msUid(), title: `シーン${ch.scenes.length + 1}`, content: '' };
    ch.scenes.push(sc);
    msSel.sceneId = sc.id;
  }
  const sc = msScene();
  sc.content = (sc.content ? sc.content.replace(/\s+$/, '') + '\n\n' : '') + t;
  if (opts.src === 'ai') recordAiSnippet(sc, t);
  renderMsTree();
  updateMsEditor();
  scheduleMsSave();
  if (openPane) msRevealPane();
  $('msStatus').textContent = `「${sc.title}」に追加しました`;
  setTimeout(() => { if ($('msStatus').textContent.startsWith('「')) $('msStatus').textContent = ''; }, 2500);
}

// ---------- AI挿入テキストの記録（出所追跡） ----------
function recordAiSnippet(sc, text) {
  sc.aiSnippets = sc.aiSnippets || [];
  // 除去時に本文から確実に見つけられるよう全文を保持（シーン上限と同じ100000字まで）
  sc.aiSnippets.push({ ts: Date.now(), text: String(text).slice(0, 100000) });
  if (sc.aiSnippets.length > 50) sc.aiSnippets = sc.aiSnippets.slice(-50);
}
// AI共著パネル（cowrite.js）からの適用：本文の start〜end を text に置き換える
export function msCommitAiEdit(start, end, text) {
  const sc = msScene();
  if (!sc) return false;
  const cur = sc.content || '';
  const s = Math.max(0, Math.min(start | 0, cur.length));
  const e = Math.max(s, Math.min(end | 0, cur.length));
  sc.content = cur.slice(0, s) + text + cur.slice(e);
  recordAiSnippet(sc, text);
  renderMsTree();
  updateMsEditor();
  scheduleMsSave();
  updateMsStats();
  return true;
}

// ---------- 流れ生成などからの一括シーン追加 ----------
// chapterTitle 指定時はその名前の章を探し、無ければ新規作成。未指定なら選択中の章（無ければ先頭/新規）
export function msAppendGenerated({ chapterTitle = '', sceneTitle = '', content = '', src = 'ai', activate = true } = {}) {
  const t = (content || '').trim();
  if (!t) return null;
  if (!manuscript.chapters.length) {
    manuscript.chapters.push({ id: msUid(), title: '第1章', scenes: [] });
  }
  let ch = null;
  const want = (chapterTitle || '').trim();
  if (want) ch = manuscript.chapters.find(c => c.title === want);
  if (!ch) ch = want ? null : msChapter();
  if (!ch) {
    ch = { id: msUid(), title: want || `第${manuscript.chapters.length + 1}章`, scenes: [] };
    manuscript.chapters.push(ch);
  }
  const sc = { id: msUid(), title: (sceneTitle || 'シーン').slice(0, 40), content: '' };
  ch.scenes.push(sc);
  sc.content = t;
  if (src) recordAiSnippet(sc, t);
  if (activate) {
    msSel.chapterId = ch.id;
    msSel.sceneId = sc.id;
    renderMsTree();
    updateMsEditor();
    msRevealPane();
  }
  return sc;
}
// 横断検索・置換用：原稿シーンの一括置換。reは/gフラグ付きRegExp。sceneIds指定で対象限定
export function msReplaceScenes(re, replacement, sceneIds = null) {
  const ids = sceneIds ? new Set(sceneIds) : null;
  let count = 0;
  const touched = [];
  for (const ch of manuscript.chapters) {
    for (const sc of ch.scenes) {
      if (ids && !ids.has(sc.id)) continue;
      const before = sc.content || '';
      const n = (before.match(re) || []).length;
      if (!n) continue;
      sc.content = before.replace(re, () => replacement);
      count += n;
      touched.push(sc.id);
    }
  }
  if (count) { renderMsTree(); updateMsEditor(); scheduleMsSave(); }
  return { count, sceneIds: touched };
}
// バッチ追加後に一度だけUIを更新する用
export function msRefresh() {
  renderMsTree();
  updateMsEditor();
  scheduleMsSave();
}
// シーン本文を外部から差し替える（履歴復元など）。選択中シーンのみ対象
export function msApplyContent(content) {
  const sc = msScene();
  if (!sc) return false;
  sc.content = String(content || '');
  renderMsTree();
  updateMsEditor();
  scheduleMsSave();
  updateMsStats();
  return true;
}

// ---------- シーンをAIに書かせる ----------
export async function msAiWrite() {
  const sc = msScene();
  if (!sc) { appAlert('シーンを選択してください（ツリーから選択）'); return; }
  const ch = msChapter();
  const hasContent = (sc.content || '').trim().length > 0;
  let lengthHint = '';
  if (!hasContent) {
    const v = await appPrompt(`シーン「${sc.title}」の生成文字数の目安`, '1500');
    if (v === null) return;
    lengthHint = (v || '').trim();
  } else if (!(await appConfirm(`シーン「${sc.title}」の末尾に続きを書きます。よろしいですか？`))) return;

  const btn = $('btnMsWrite');
  if (btn) btn.disabled = true;
  $('msStatus').textContent = 'AIが執筆中…';
  try {
    // 文脈収集：章/シーン情報・直前シーン末尾・選択カード・文体指定
    const flat = manuscript.chapters.flatMap(c => c.scenes);
    const idx = flat.findIndex(s => s.id === sc.id);
    const prev = idx > 0 ? flat[idx - 1] : null;
    const prevTail = prev ? `【直前のシーン「${prev.title}」末尾】\n${(prev.content || '').slice(-1200)}` : '';
    const tail = hasContent ? `【このシーンの既存本文（末尾）】\n${(sc.content || '').slice(-2500)}` : '';

    const selIds = new Set(current?.cardIds || []);
    const cardText = allCards
      .filter(c => selIds.size ? selIds.has(c.id) : true)
      .filter(c => c.content)
      .slice(0, 12)
      .map(c => `【${c.name}】（${c.kind || 'term'}）\n${(c.content || '').slice(0, 700)}`)
      .join('\n\n')
      .slice(0, 9000);

    const styleText = config?.stylePreset || '';
    const { text } = await callApiOnce([
      { role: 'system', content: 'あなたは小説家です。指定されたシーンの本文のみを執筆してください。見出し・説明・前置き・Markdown装飾は一切不要で、本文だけを出力してください。文体・視点・トーンは指定があればそれに従い、直前の本文がある場合はその流れを自然に継いでください。' },
      { role: 'user', content: [
        `【章】${ch?.title || ''}`,
        `【シーン】${sc.title}`,
        sc.plot ? `【プロットメモ】${sc.plot}` : '',
        styleText ? `【文体指定】${styleText}` : '',
        styleSampleBlock() || '',
        lengthHint ? `【指示】${lengthHint}字程度で執筆してください` : '',
        prevTail,
        tail,
        cardText ? `【設定・登場人物】\n${cardText}` : '',
        hasContent ? '上記の既存本文の直後に続く文章を執筆してください。' : 'このシーンの本文を最初から執筆してください。'
      ].filter(Boolean).join('\n\n') }
    ]);
    const add = (text || '').trim();
    if (!add) { $('msStatus').textContent = '生成結果が空でした'; return; }
    // 生成中にシーンが削除された・ユーザーが本文を編集した場合に備えて再確認
    if (!msChapter()?.scenes.includes(sc)) { $('msStatus').textContent = 'シーンが削除されたため結果を破棄しました'; return; }
    const cur = (sc.content || '').trim();
    sc.content = cur ? cur.replace(/\s+$/, '') + '\n\n' + add : add;
    recordAiSnippet(sc, add);
    renderMsTree();
    updateMsEditor();
    scheduleMsSave();
    $('msStatus').textContent = `「${sc.title}」に${hasContent ? '続きを' : '本文を'}追加しました`;
    setTimeout(() => { if ($('msStatus').textContent.includes('追加しました')) $('msStatus').textContent = ''; }, 3000);
  } catch (e) {
    $('msStatus').textContent = '生成失敗: ' + (e.message || e);
  } finally {
    if (btn) btn.disabled = false;
  }
}
export async function msAddChapter() {
  const n = manuscript.chapters.length + 1;
  const title = await appPrompt('章名を入力', `第${n}章`);
  if (title === null) return;
  const ch = { id: msUid(), title: title.trim() || `第${n}章`, scenes: [{ id: msUid(), title: 'シーン1', content: '' }] };
  manuscript.chapters.push(ch);
  msSel.chapterId = ch.id; msSel.sceneId = ch.scenes[0].id;
  renderMsTree(); updateMsEditor(); scheduleMsSave();
}
export async function msAddScene() {
  let ch = msChapter() || manuscript.chapters[0];
  if (!ch) return msAddChapter();
  msSel.chapterId = ch.id;
  const sc = { id: msUid(), title: `シーン${ch.scenes.length + 1}`, content: '' };
  ch.scenes.push(sc);
  msSel.sceneId = sc.id;
  renderMsTree(); updateMsEditor(); scheduleMsSave();
}
export async function msDuplicateScene() {
  const sc = msScene();
  const ch = msChapter();
  if (!sc || !ch) { appAlert('シーンを選択してください'); return; }
  const copy = {
    id: msUid(),
    title: (sc.title || 'シーン') + 'のコピー',
    content: sc.content || '',
    ...(sc.plot ? { plot: sc.plot } : {}),
    ...(sc.aiSnippets?.length ? { aiSnippets: sc.aiSnippets.map(s => ({ ...s })) } : {})
  };
  const idx = ch.scenes.findIndex(s => s.id === sc.id);
  ch.scenes.splice(idx + 1, 0, copy);
  msSel.sceneId = copy.id;
  renderMsTree(); updateMsEditor(); scheduleMsSave();
}
export async function msDuplicateChapter() {
  const ch = msChapter();
  if (!ch) { appAlert('章を選択してください（ツリーの章名をクリック）'); return; }
  const copy = {
    id: msUid(),
    title: (ch.title || '章') + 'のコピー',
    scenes: ch.scenes.map(s => ({
      id: msUid(), title: s.title, content: s.content || '',
      ...(s.plot ? { plot: s.plot } : {}),
      ...(s.aiSnippets?.length ? { aiSnippets: s.aiSnippets.map(x => ({ ...x })) } : {})
    }))
  };
  const i = manuscript.chapters.findIndex(c => c.id === ch.id);
  manuscript.chapters.splice(i + 1, 0, copy);
  msSel.chapterId = copy.id;
  msSel.sceneId = copy.scenes[0]?.id || null;
  renderMsTree(); updateMsEditor(); scheduleMsSave();
}
function msMoveChapter(ch, dir) {
  const i = manuscript.chapters.findIndex(c => c.id === ch.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= manuscript.chapters.length) return;
  [manuscript.chapters[i], manuscript.chapters[j]] = [manuscript.chapters[j], manuscript.chapters[i]];
  renderMsTree();
  scheduleMsSave();
}
function msMoveScene(ch, sc, dir) {
  const i = ch.scenes.findIndex(s => s.id === sc.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ch.scenes.length) return;
  [ch.scenes[i], ch.scenes[j]] = [ch.scenes[j], ch.scenes[i]];
  renderMsTree();
  scheduleMsSave();
}
export async function msDelete() {
  const sc = msScene();
  const ch = msChapter();
  if (sc) {
    if (!(await appConfirm(`シーン「${sc.title}」を削除しますか？`))) return;
    ch.scenes = ch.scenes.filter(s => s.id !== sc.id);
    msSel.sceneId = ch.scenes[0]?.id || null;
  } else if (ch) {
    if (!(await appConfirm(`章「${ch.title}」を削除しますか？`))) return;
    manuscript.chapters = manuscript.chapters.filter(c => c.id !== ch.id);
    msSel.chapterId = manuscript.chapters[0]?.id || null;
    msSel.sceneId = msChapter()?.scenes[0]?.id || null;
  } else return;
  renderMsTree(); updateMsEditor(); scheduleMsSave();
}
// ---------- Plan view（章・シーンのカードボード） ----------
export function toggleMsBoard() {
  const el = $('msBoard');
  if (!el) return;
  const show = el.classList.contains('hidden');
  if (show) renderMsBoard();
  el.classList.toggle('hidden', !show);
  $('btnMsBoard')?.classList.toggle('active', show);
}
function renderMsBoard() {
  const el = $('msBoard');
  el.innerHTML = '';
  if (!manuscript.chapters.length) {
    el.innerHTML = '<p class="hint" style="padding:8px">まだ章がありません</p>';
    return;
  }
  for (const ch of manuscript.chapters) {
    const head = document.createElement('div');
    head.className = 'ms-board-ch';
    head.textContent = ch.title;
    el.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'ms-board-grid';
    for (const sc of ch.scenes) {
      const card = document.createElement('div');
      card.className = 'ms-scene-card' + (sc.id === msSel.sceneId ? ' sel' : '');
      const first = (sc.content || '').replace(/\s+/g, ' ').slice(0, 80);
      card.innerHTML = `<div class="ms-scene-card-title"></div>
        <div class="ms-scene-card-meta hint"></div>
        <div class="ms-scene-card-prev"></div>`;
      card.querySelector('.ms-scene-card-title').textContent = sc.title;
      card.querySelector('.ms-scene-card-meta').textContent =
        `${(sc.content || '').length.toLocaleString()}字` + (sc.aiSnippets?.length ? ` · AI${sc.aiSnippets.length}` : '');
      card.querySelector('.ms-scene-card-prev').textContent = first || '（未執筆）';
      if (sc.plot) {
        const pm = document.createElement('div');
        pm.className = 'ms-scene-card-plot hint';
        pm.textContent = '📋 ' + sc.plot;
        card.appendChild(pm);
      }
      card.onclick = () => {
        msSel.chapterId = ch.id; msSel.sceneId = sc.id;
        renderMsTree(); updateMsEditor(); renderMsBoard();
      };
      grid.appendChild(card);
    }
    el.appendChild(grid);
  }
}

// ---------- AI挿入部分の一覧・除去 ----------
export function msShowAiParts() {
  const sc = msScene();
  if (!sc) { appAlert('シーンを選択してください'); return; }
  const list = sc.aiSnippets || [];
  if (!list.length) { appAlert('このシーンにAI挿入されたテキストはありません'); return; }
  let html = `<p class="hint">シーン「${esc(sc.title)}」にAIが書いた部分（${list.length}件）。「除去」で本文から取り除きます。</p>`;
  list.forEach((sn, i) => {
    const preview = sn.text.replace(/\s+/g, ' ').slice(0, 120);
    html += `<div class="card-item"><div class="hint">${new Date(sn.ts).toLocaleString('ja-JP')}</div>
      <div style="margin:6px 0;white-space:pre-wrap">${esc(preview)}${sn.text.length > 120 ? '…' : ''}</div>
      <button class="qb ai-rm" data-i="${i}">本文から除去</button></div>`;
  });
  showResultModal('AI挿入部分', html);
  $('resultBody').querySelectorAll('.ai-rm').forEach(b => {
    b.onclick = async () => {
      const i = parseInt(b.dataset.i, 10);
      const sn = sc.aiSnippets?.[i];
      if (!sn) return;
      if (!(await appConfirm('このAI挿入テキストを本文から取り除きますか？（取り消し不可）'))) return;
      // 末尾から探す（同一文の重複挿入で最新＝対象側を優先）。見つかった時だけ記録を消す
      const idx = sc.content.lastIndexOf(sn.text);
      if (idx >= 0) {
        sc.content = (sc.content.slice(0, idx) + sc.content.slice(idx + sn.text.length)).replace(/\n{3,}/g, '\n\n');
        sc.aiSnippets.splice(i, 1);
        renderMsTree(); updateMsEditor(); scheduleMsSave();
        msShowAiParts();
      } else {
        appAlert('本文内に該当テキストが見つかりませんでした（編集済みの可能性）。記録は残しています。');
      }
    };
  });
}

export function exportManuscript() {
  let out = '';
  for (const ch of manuscript.chapters) {
    out += `\n\n【${ch.title}】\n\n`;
    for (const sc of ch.scenes) out += `〔${sc.title}〕\n\n${sc.content}\n\n`;
  }
  if (!out.trim()) { appAlert('原稿がまだありません'); return; }
  downloadFile((manuscript.title || 'manuscript') + '.txt', out.trim(), 'text/plain');
}

// ---------- 選択範囲→カード化 ----------
export async function msSelectionToCard() {
  const ta = $('msEditor');
  const sc = msScene();
  if (!ta || !sc) return;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  if (!sel) { appAlert('カードにする文章を本文で選択してください'); return; }
  // ダイアログ表示で選択位置がずれないよう、先に範囲を確定する
  const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
  const name = await appPrompt('カード名を入力（人物名・用語・設定など）', sel.slice(0, 30));
  if (name === null) return;
  const nm = name.trim() || sel.slice(0, 30);
  const cur = ta.value;
  const before = cur.slice(Math.max(0, selStart - 200), selStart);
  const after = cur.slice(selEnd, selEnd + 200);
  const content = `【出典】原稿「${sc.title}」で選択して登録\n\n…${before}【${sel}】${after}…`;
  const c = await api('/api/cards', { method: 'POST', body: JSON.stringify({ name: nm, kind: 'term', content }) });
  const { refreshCards } = await import('./cards.js');
  await refreshCards();
  const st = $('msStatus');
  if (st) { st.textContent = `カード「${nm}」を作成しました`; setTimeout(() => { if (st.textContent.includes('を作成しました')) st.textContent = ''; }, 3000); }
  // カード編集モーダルを開いて種類・内容を整えられるようにする
  try { const { openCardsModal } = await import('./cards.js'); openCardsModal(c); } catch {}
}

// ---------- シーン整形 ----------
const MS_FORMATS = {
  indent: {
    label: '字下げ：各行の行頭に全角スペース',
    fn: t => t.split('\n').map(l => l.trim() ? '　' + l.replace(/^[\s　]+/, '') : l).join('\n')
  },
  unindent: {
    label: '行頭の空白をすべて削除',
    fn: t => t.split('\n').map(l => l.replace(/^[\s　]+/, '')).join('\n')
  },
  blank: {
    label: '連続する空行を1つに',
    fn: t => t.replace(/\n{3,}/g, '\n\n')
  },
  punct: {
    label: '句読点の重複を修正（、、→、 等）',
    fn: t => t.replace(/([、。，．！？])\1+/g, '$1')
  },
  spaces: {
    label: '連続する空白を1つに',
    fn: t => t.replace(/[ 　\t]{2,}/g, m => m.includes('　') ? '　' : ' ')
  }
};
export function msFormatScene(kind) {
  const sc = msScene();
  const f = MS_FORMATS[kind];
  if (!sc || !f) return;
  const before = sc.content || '';
  const after = f.fn(before);
  if (after === before) {
    const st = $('msStatus'); if (st) { st.textContent = '整形：変更はありませんでした'; setTimeout(() => { st.textContent = ''; }, 2000); }
    return;
  }
  sc.content = after;
  renderMsTree(); updateMsEditor(); scheduleMsSave(); updateMsStats();
  const st = $('msStatus'); if (st) { st.textContent = `整形しました（${f.label}）`; setTimeout(() => { if (st.textContent.startsWith('整形')) st.textContent = ''; }, 3000); }
}

// ---------- シーン間ワープ ----------
function msFlatScenes() {
  const out = [];
  for (const ch of manuscript.chapters) for (const sc of ch.scenes) out.push({ ch, sc });
  return out;
}
export function msGotoScene(dir) {
  const flat = msFlatScenes();
  const i = flat.findIndex(x => x.sc.id === msSel.sceneId);
  const j = i + dir;
  if (j < 0 || j >= flat.length) return;
  msSel.chapterId = flat[j].ch.id;
  msSel.sceneId = flat[j].sc.id;
  renderMsTree(); updateMsEditor();
  document.querySelector('.ms-sc.sel')?.scrollIntoView({ block: 'nearest' });
}
export function msInsertPrevTail() {
  const flat = listManuscriptScenes();
  const i = flat.findIndex(x => x.id === msSel.sceneId);
  const prev = i > 0 ? flat[i - 1] : null;
  if (!prev || !(prev.content || '').trim()) { appAlert('前のシーンがありません'); return; }
  const tail = prev.content.trim().slice(-400);
  const ta = $('msEditor');
  if (!ta) return;
  ta.focus();
  ta.setRangeText(tail, ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- ピン留め参照 ----------
const msPins = (() => { try { return JSON.parse(localStorage.getItem('ms_pins') || '[]'); } catch { return []; } })();
function saveMsPins() { localStorage.setItem('ms_pins', JSON.stringify(msPins.slice(0, 20))); }
export function msPinSelection() {
  const ta = $('msEditor');
  if (!ta) return;
  const t = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  if (!t) { appAlert('ピン留めする文章を本文で選択してください'); return; }
  msPins.unshift({ text: t.slice(0, 500), ts: Date.now() });
  if (msPins.length > 20) msPins.length = 20;
  saveMsPins();
  renderMsPins();
}
export function renderMsPins() {
  const el = $('msPins');
  if (!el) return;
  el.innerHTML = '';
  el.classList.toggle('hidden', !msPins.length);
  for (const p of msPins) {
    const chip = document.createElement('span');
    chip.className = 'ms-pin';
    chip.title = 'クリックでコピー / ×で削除';
    const label = document.createElement('span');
    label.className = 'ms-pin-text';
    label.textContent = p.text.length > 40 ? p.text.slice(0, 39) + '…' : p.text;
    const x = document.createElement('button');
    x.className = 'ms-pin-x';
    x.textContent = '×';
    x.onclick = (e) => {
      e.stopPropagation();
      const i = msPins.indexOf(p);
      if (i >= 0) msPins.splice(i, 1);
      saveMsPins(); renderMsPins();
    };
    chip.appendChild(label); chip.appendChild(x);
    chip.onclick = async () => {
      try { await navigator.clipboard.writeText(p.text); } catch {}
      const st = $('msStatus');
      if (st) { st.textContent = 'ピン留めをコピーしました'; setTimeout(() => { if (st.textContent === 'ピン留めをコピーしました') st.textContent = ''; }, 2000); }
    };
    el.appendChild(chip);
  }
}

// ---------- AIテキストをシーン末尾に追記（相談回答の反映など） ----------
export function msAppendAiText(text, targetScene = null) {
  const sc = targetScene || msScene();
  const t = (text || '').trim();
  if (!sc || !t) return false;
  sc.content = (sc.content || '').trimEnd() ? (sc.content || '').trimEnd() + '\n\n' + t : t;
  recordAiSnippet(sc, t);
  renderMsTree();
  updateMsEditor();
  scheduleMsSave();
  updateMsStats();
  return true;
}

// ---------- 組版HTML出力（《漢字|よみ》ルビ・《＊字》傍点） ----------
function typesetLine(line) {
  let s = esc(line);
  // 《＊…》 傍点
  s = s.replace(/《\*([^》]+)》/g, '<span class="emphasis-dots">$1</span>');
  // 《漢字|よみ》 ルビ
  s = s.replace(/《([^|》]+)\|([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
  return s;
}
export function exportManuscriptHtml(vertical = true) {
  if (!manuscript.chapters.length) { appAlert('原稿がまだありません'); return; }
  let body = '';
  for (const ch of manuscript.chapters) {
    body += `<section class="chapter"><h2>${esc(ch.title)}</h2>`;
    for (const sc of ch.scenes) {
      const paras = (sc.content || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      body += `<section class="scene"><h3>${esc(sc.title)}</h3>` +
        paras.map(p => `<p>${typesetLine(p).replace(/\n/g, '<br>')}</p>`).join('') +
        `</section>`;
    }
    body += `</section>`;
  }
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>${esc(manuscript.title || 'manuscript')}</title>
<style>
body { font-family: "Hiragino Mincho ProN","Yu Mincho",serif; max-width: 42em; margin: 2em auto; padding: 0 1em; line-height: 2; }
h1 { font-size: 1.6em; text-align: center; }
h2 { font-size: 1.2em; border-bottom: 1px solid #ccc; padding-bottom: .3em; margin-top: 2em; }
h3 { font-size: 1.05em; color: #555; }
${vertical ? 'body { writing-mode: vertical-rl; }' : ''}
ruby rt { font-size: .5em; }
.emphasis-dots { text-emphasis: dot; -webkit-text-emphasis: dot; }
p { margin: .8em 0; text-indent: 1em; }
</style></head><body>
<h1>${esc(manuscript.title || '無題')}</h1>${body}
</body></html>`;
  downloadFile((manuscript.title || 'manuscript') + '.html', html, 'text/html');
}

// ---------- 章まとめてAI執筆（空シーンを順番に生成） ----------
let msChapterWriteCancel = false;
export function msCancelChapterWrite() { msChapterWriteCancel = true; }
export async function msWriteChapter() {
  const ch = msChapter();
  if (!ch) { appAlert('章を選択してください（ツリーの章名をクリック）'); return; }
  const empties = ch.scenes.filter(s => !(s.content || '').trim());
  if (!empties.length) { appAlert('この章に空のシーンがありません'); return; }
  const targets = empties.slice(0, 10);
  if (targets.length < empties.length) {
    if (!(await appConfirm(`この章には空シーンが${empties.length}件あります。先頭${targets.length}件のみ生成します。続けますか？`))) return;
  } else if (!(await appConfirm(`この章の空シーン${targets.length}件に、順番にAIが本文を執筆します。よろしいですか？`))) return;

  msChapterWriteCancel = false;
  const btn = $('btnMsWriteChapter');
  const btnLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = false; btn.textContent = '中断'; btn.onclick = msCancelChapterWrite; }
  const st = $('msStatus');
  try {
    for (let i = 0; i < targets.length; i++) {
      if (msChapterWriteCancel) break;
      const sc = targets[i];
      if ((sc.content || '').trim()) continue; // 生成中にユーザーが書いた場合はスキップ
      if (st) st.textContent = `章AI執筆 ${i + 1}/${targets.length}「${sc.title}」生成中…`;
      // 直前シーン（この章内・生成済みを含む）の末尾を文脈に
      const idx = ch.scenes.findIndex(s => s.id === sc.id);
      const prev = idx > 0 ? ch.scenes[idx - 1] : null;
      const prevTail = prev && (prev.content || '').trim()
        ? `【直前のシーン「${prev.title}」末尾】\n${prev.content.trim().slice(-1200)}` : '';
      const selIds = new Set(current?.cardIds || []);
      const cardText = allCards
        .filter(c => selIds.size ? selIds.has(c.id) : true)
        .filter(c => c.content)
        .slice(0, 10)
        .map(c => `【${c.name}】（${c.kind || 'term'}）\n${(c.content || '').slice(0, 500)}`)
        .join('\n\n')
        .slice(0, 7000);
      const styleText = config?.stylePreset || '';
      const { text } = await callApiOnce([
        { role: 'system', content: 'あなたは小説家です。指定されたシーンの本文のみを執筆してください。見出し・説明・前置き・Markdown装飾は一切不要で、本文だけを出力してください。文体・視点・トーンは指定があればそれに従い、直前の本文がある場合はその流れを自然に継いでください。' },
        { role: 'user', content: [
          `【章】${ch.title}`,
          `【シーン】${sc.title}`,
          sc.plot ? `【プロットメモ】${sc.plot}` : '',
          styleText ? `【文体指定】${styleText}` : '',
          styleSampleBlock() || '',
          prevTail,
          cardText ? `【設定・登場人物】\n${cardText}` : '',
          'このシーンの本文を最初から執筆してください。'
        ].filter(Boolean).join('\n\n') }
      ]);
      const add = (text || '').trim();
      if (add && ch.scenes.includes(sc) && !(sc.content || '').trim()) {
        sc.content = add;
        recordAiSnippet(sc, add);
        if (sc.id === msSel.sceneId) { renderMsTree(); updateMsEditor(); }
        else renderMsTree();
        scheduleMsSave();
        updateMsStats();
      }
    }
    if (st) st.textContent = msChapterWriteCancel ? '章AI執筆を中断しました' : '章AI執筆が完了しました';
  } catch (e) {
    if (st) st.textContent = '生成失敗: ' + (e.message || e);
  } finally {
    msChapterWriteCancel = false;
    if (btn) { btn.textContent = btnLabel; btn.onclick = msWriteChapter; }
    setTimeout(() => { if (st && (st.textContent.includes('章AI執筆') || st.textContent === '章AI執筆が完了しました')) st.textContent = ''; }, 4000);
  }
}
