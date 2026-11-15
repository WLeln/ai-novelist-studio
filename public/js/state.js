// 共有状態（モジュール間で読み書きする可変状態）
// 注意: export した let への直接代入は他モジュールからは不可。再代入は必ず setXxx を使う
// （読み取りは live binding で常に最新値が見える）

export let config = null;
export let allCards = [];
export let allTemplates = [];
export let allSources = [];
export let allDocs = [];
export let allPresets = [];
export let cardsVersion = 0; // カード変更検知用（effectiveCardIdsキャッシュの無効化）
export let current = null;
export let busy = false;
export let abortCtrl = null;
export let pendingStyle = false; // 文体プロファイル抽出の生成を待っているフラグ

export const setConfig = (v) => { config = v; };
export const setAllCards = (v) => { allCards = v; };
export const setAllTemplates = (v) => { allTemplates = v; };
export const setAllSources = (v) => { allSources = v; };
export const setAllDocs = (v) => { allDocs = v; };
export const setAllPresets = (v) => { allPresets = v; };
export const setCardsVersion = (v) => { cardsVersion = v; };
export const setCurrent = (v) => { current = v; };
export const setBusyState = (v) => { busy = v; };
export const setAbortCtrl = (v) => { abortCtrl = v; };
export const setPendingStyle = (v) => { pendingStyle = v; };

// 下書き保存キー（会話ごと）
export const draftKey = () => 'draft_' + (current?.id || '');

export const STYLE_PRESETS = {
  '': '',
  'normal': 'ノーマルな小説文で、自然で読みやすい日本語を心がけてください。',
  'ranobe': 'ライトノベル風の軽快でテンポの良い文体で書いてください。',
  'jidaigeki': '時代劇・歴史小説のような格式高い文体で書いてください。',
  'horror': 'ホラー・ミステリー小説のように、緊張感と陰影のある文体で書いてください。',
  'bungei': '文芸小説のように詩的で装飾的な文体で書いてください。'
};
export const CARD_KINDS = { character: 'キャラ', world: '世界観', term: '用語', foreshadow: '伏線', style: '文体' };

// お楽しみ機能・細かい設定（localStorage）
export const fun = {
  neko: localStorage.getItem('fun_neko') === '1',
  sakura: localStorage.getItem('fun_sakura') === '1',
  infinite: false,
  infiniteCount: 0,
  mood: localStorage.getItem('fun_mood') || '機嫌がいい',
  theme: localStorage.getItem('ui_theme') || 'auto',
  aiName: localStorage.getItem('fun_ainame') || '',
  ears: localStorage.getItem('fun_ears') === '1',
  bgm: false,
  writingMode: localStorage.getItem('fun_writingmode') === '1',
  autoMs: localStorage.getItem('fun_automs') === '1'
};
export const saveFun = (k) => localStorage.setItem('fun_' + k, fun[k] ? '1' : '0');
localStorage.setItem('fun_mood', fun.mood);

// ---------- 文体お手本（自分の文章サンプルをAI生成に自動注入） ----------
export function styleSampleText() {
  try { return (localStorage.getItem('style_sample') || '').slice(0, 4000); } catch { return ''; }
}
export function saveStyleSample(text) {
  try { localStorage.setItem('style_sample', String(text || '').slice(0, 4000)); } catch {}
}
export function clearStyleSample() {
  try { localStorage.removeItem('style_sample'); } catch {}
}
// プロンプト注入用ブロック（空なら空文字）
export function styleSampleBlock() {
  const t = styleSampleText().trim();
  return t ? `【文体お手本（この筆致・語彙・リズムを忠実に模倣すること）】\n${t}` : '';
}

// ---------- 繰り返しワード自動検出（AI不使用・プロンプト自動注入用） ----------
// 漢字熟語(2+)・カタカナ(2+)・ひらがな(3+)を対象に、
// 「全体で5回以上」かつ「800字窓内に3回以上」= 局所的な多用（タイムワード化）を検出。
// 窓判定にすることで「彼女」のような全編に散らばる普通の頻出語は誤検出しない。
const REP_STOP = new Set(('する いる ある なる れる られる できる いく くる いった てる ている ました ません だっ だった など こと もの ため よう それ これ あれ どれ そこ ここ まだ もう しかし だから そして また ちょうど ずっと やっと きっと たぶん もちろん いわゆる かなり ようやく とうとう あまり すこし ちょっと まさに 実に 非常に とても あまりに 少しも 全く まったく いよいよ だんだん ますます ' +
  // 人称・基本名詞（言い換え不能な語は検出対象外）
  '彼女 彼 私 僕 俺 あなた みんな 皆 自分 相手 友達 友人 家族 両親 父 母 弟 妹 兄 姉 男 女 子供 人々 誰か 何か 誰も 何も これら それら あれら 例えば 実は つまり 結局 要するに').split(' '));
// ひらがな候補の動詞活用語尾を除外（「止まらない」→「まらない」等の誤検出防止）
const REP_HIRA_NG = /(ない|った|って|いる|ある|する|れる|せる|たい|です|ます|だっ|んだ|しかっ|ながら|つつ|けど|ので|のに|から|まで|より|だけ|しか|ほど|など|ってば|ったら|[にへをがはでと])$/;
const REP_RE = /[一-龯々〆ヵヶ]{2,}|[ァ-ヶー]{2,}|[ぁ-ん]{3,}/g;
const repAccept = (w) => !REP_STOP.has(w) && !(/^[ぁ-ん]+$/.test(w) && REP_HIRA_NG.test(w));
export function overusedWords(text, { window = 800, minLocal = 3, minTotal = 5 } = {}) {
  if (!text || text.length < 200) return [];
  const freq = new Map();  // word -> {total, maxWin}
  const bump = (w, win) => {
    const e = freq.get(w) || { total: 0, maxWin: 0 };
    e.total += 1;
    e.maxWin = Math.max(e.maxWin, win);
    freq.set(w, e);
  };
  // 全体カウント
  for (const m of text.matchAll(REP_RE)) {
    const w = m[0];
    if (repAccept(w)) bump(w, 0);
  }
  // 800字窓（400字ステップのオーバーラップ）で局所最大を計る
  for (let i = 0; i < text.length; i += 400) {
    const chunk = text.slice(i, i + window);
    if (chunk.length < 100) continue;
    const local = new Map();
    for (const m of chunk.matchAll(REP_RE)) {
      const w = m[0];
      if (!repAccept(w)) continue;
      local.set(w, (local.get(w) || 0) + 1);
    }
    for (const [w, c] of local) {
      const e = freq.get(w);
      if (e) e.maxWin = Math.max(e.maxWin, c);
    }
  }
  return [...freq.entries()]
    .filter(([, e]) => e.total >= minTotal && e.maxWin >= minLocal)
    .map(([word, e]) => ({ word, count: e.total, local: e.maxWin }))
    .sort((a, b) => b.local - a.local || b.count - a.count)
    .slice(0, 8);
}
// プロンプト注入ブロック（検出なし・設定でOFFなら空文字）
export function overusedWordBlock(texts) {
  if (config?.params?.repGuard === false) return '';
  const all = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('\n');
  const words = overusedWords(all);
  if (!words.length) return '';
  return '【言い換え指示】直近の文章で次の語が局所的に繰り返し使われています。同じ語を連続して使わず、類義語・別表現・文の省略で自然に言い換えてください: ' +
    words.map(w => `「${w.word}」`).join('、');
}
