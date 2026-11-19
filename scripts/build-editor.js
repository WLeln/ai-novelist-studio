// editor/index.js を esbuild でバンドルして public/js/editor.bundle.js を生成する。
// UNCパス上では cmd 経由の esbuild CLI がカレントディレクトリを解決できず失敗するため、
// esbuild の JS API を直接呼んで絶対パスで解決する（AGENTS.md の UNC 問題対策）。
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild.build({
  entryPoints: [path.join(root, 'editor', 'index.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(root, 'public', 'js', 'editor.bundle.js'),
  logLevel: 'info'
}).then(() => {
  console.log('editor.bundle.js を生成しました');
}).catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
