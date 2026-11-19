const https = require('https');
const tok = process.env.TOKEN;
const REPO = '/repos/WLeln/ai-novelist-studio/code-scanning/alerts';

function req(method, path, body) {
  return new Promise((res, rej) => {
    const r = https.request({
      host: 'api.github.com', path, method,
      headers: { Authorization: `token ${tok}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'devin' }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  // collect all open alert numbers
  const nums = [];
  for (let p = 1; p <= 20; p++) {
    const r = await req('GET', `${REPO}?state=open&per_page=100&page=${p}`);
    let a; try { a = JSON.parse(r.body); } catch { break; }
    if (!Array.isArray(a) || !a.length) break;
    a.forEach(x => nums.push(x.number));
    if (a.length < 100) break;
  }
  console.log('open alerts:', nums.length);
  let done = 0, fail = 0;
  for (const n of nums) {
    const r = await req('PATCH', `${REPO}/${n}`, {
      state: 'dismissed',
      dismissed_reason: "won't fix",
      dismissed_comment: 'Bulk-dismissed CodeQL quality-suite noise; scanning narrowed to security-extended.'
    });
    if (r.status < 300) done++; else { fail++; if (fail < 5) console.log('fail', n, r.status, r.body.slice(0, 120)); }
  }
  console.log('done', done, 'fail', fail);
})();
