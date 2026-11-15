# AI Novelist Studio

Express + SQLite（node:sqlite）のバックエンド（server.js）と、バンドルなしのES Modulesフロントエンド（public/js/、app.jsがエントリ）。Electron対応。

## コマンド

- 起動: `npm start`（http://localhost:3737）
- 検証: `node --check server.js`、ブラウザで `/` を開く
- データ: `%APPDATA%/AI Novelist Studio/data/app.db`（SQLite docsテーブル、kind+idで全データ管理）

## リッチテキストエディタ（ドキュメント機能）

- エディタはTipTap v2。ソースは `editor/index.js`、成果物は `public/js/editor.bundle.js`（IIFE、`window.DocEditor`）。
- リビルド: `npm run build:editor`
- **注意**: ワークスペースがUNCパス（\\server\share）上にあると esbuild の cmd 起動と npm の postinstall が失敗する。
  - npm install は `npm i --ignore-scripts` を使う（electron-winstaller のスクリプトがUNCで落ちる）
  - esbuild がUNCで動かない場合はローカル一時ディレクトリに tiptap+esbuild を入れてそこでバンドルし、生成物を `public/js/` にコピーする
- ドキュメントAPI: `/api/documents` CRUD（server.js、kind='doc'）
- フロント: `public/js/documents.js`。タブは `{type:'conv'|'doc', id}` で localStorage `open_tabs` に保存（docタブは `d:` プレフィックス）

## 構成メモ

- タブ・会話一覧は conversations.js、ドキュメントは documents.js。タブ種別の追加は `registerTabOpener(type, fn)` で登録
- ビュー切替は showChatView / showDocView / showGraphView（conversations.js）
- 物語グラフ（関連グラフ）: `public/js/worldgraph.js`、タブtype `graph`（singleton id='main'、タブキー `g:`）。ノード=カード/ドキュメント/原稿シーン/ソース/会話、エッジ=カード名言及の自動スキャン＋会話紐付け＋手動関連。配置・手動エッジは `/api/worldgraph`（kind='worldgraph'）に保存
- 一貫性チェック（小説lint）: `public/js/consistency.js`、ツールメニュー「一貫性チェック」。カード数値(歳/cm/kg/km)と本文の矛盾・未登場・重複を検出
- 横断検索・置換: `public/js/searchreplace.js`、ツールメニュー「横断検索・置換」。原稿/ドキュメント/ソース対象、`msReplaceScenes()`で原稿一括置換
- タイムマシン: `public/js/timemachine.js` + server.js `/api/timemachine`。kind='tmsnap'/'tmsnapdata'に全docsダンプ(最大150件)。writeDoc/deleteDocフックで30分毎自動記録（変更時のみ・config除外）。復元はDB+インメモリストア両方を再構築（`rebuildMemoryStores`）
- シーン相談: `public/js/sceneconsult.js`、原稿ツールバー「相談」。シーンの`aiNotes`（Q&A・最大20件）に保存。PUT /api/manuscriptでサニタイズ
- シーン履歴: `public/js/scenehist.js`、原稿ツールバー「履歴」。server.jsが原稿PUT時に本文変更シーンの旧版をkind='scenehist'に記録（20版/シーン・30万字）。`/api/scenehist/:sceneId[/:idx]`
- バックアップ: `public/js/backup.js`、ツールメニュー「バックアップ / 復元」。`/api/backup`で全docsをJSONダンプ（tmsnap系除外・config含む）、`/api/backup/restore`で全置換＋メモリ再構築→リロード
- カード知識DB化: cardCRUDに`aliases`/`relations`フィールド。cards.jsに登場シーン逆引き（カード名+別名でシーン/ソース検索→`window.__openScene`ジャンプ）。`cardextract.js`でAI応答・相談回答からカード候補を抽出（messages.jsの「カード抽出」ボタン、consultの「カード化」ボタンから動的import）
- 原稿プロットメモ: シーンの`plot`フィールド（2000字）。`msPlotMemo`入力・ボード表示・AIコンテキスト（cowrite/msAiWrite/msWriteChapter/consult）に注入
- 組版出力: `exportManuscriptHtml()`。本文中の`《漢字|よみ》`→ルビ、`《＊字》`→傍点としてHTML出力（縦書きCSS付き）
- 文体お手本: `style_sample`（localStorage・state.jsのstyleSampleBlock()）。文体分析モーダル「お手本として登録」で保存。composeSystemPrompt/cowrite/msAiWrite/msWriteChapter/ghostwrite/sceneconsultに自動注入
- 章AI執筆: `msWriteChapter()`（manuscript.js）。章内の空シーンを最大10件まで順番に生成。`msAppendAiText()`で相談回答などをシーン末尾にAI追記
- ノート（Zettelkasten）: `public/js/notes.js`、タブtype `note`（singleton id='main'、タブキー `n:`）。kind='note' を cardCRUD でCRUD（/api/notes）。`[[名前]]`リンク・`#タグ`・被リンク一覧・カード/ソース昇格。ビューは showNotesView（conversations.js）
- ノートIME: notes.js内。noteContentで `[[` →ノート名補完（Tab/Enter確定・未作成なら新規作成候補）、`#` →タグ補完。position:fixedの #noteSuggest ポップアップ
