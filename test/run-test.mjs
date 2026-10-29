import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8777;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'test/test-copy.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const DIRTY = 'https://x.com/example_user/status/1234567890?a=xxxxxxxxxxxx&s=20';
const CLEAN = 'https://x.com/example_user/status/1234567890';

const CASES = [
  { id: 'b1', name: 'writeText', expect: CLEAN },
  { id: 'b2', name: 'write(ClipboardItem)', expect: CLEAN },
  { id: 'b3', name: 'execCommand + copy@document', expect: CLEAN },
  { id: 'b4', name: 'execCommand + copy@window-capture', expect: CLEAN },
  { id: 'b5', name: 'already clean (untouched)', expect: CLEAN },
  { id: 'b6', name: 'other site (untouched)', expect: 'https://example.com/a/status/1?s=20' },
  { id: 'b7', name: 'prose with link (untouched)', expect: '看看这条：' + DIRTY + ' 挺有意思的' },
  { id: 'b8', name: 'execCommand native selection', expect: CLEAN },
  { id: 'b9', name: 'menu "copy link" intercepted', expect: CLEAN, blockedHandler: 'copy' },
  { id: 'b10', name: 'menu "share via" not intercepted', expect: CLEAN, ranHandler: 'share' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`http://127.0.0.1:${PORT}/test/test-copy.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);

let pass = 0, fail = 0;
for (const c of CASES) {
  await page.evaluate(() => { navigator.clipboard.writeText('__SENTINEL__'); window.__pageHandlerRan = null; });
  await page.click('#' + c.id);
  await page.waitForTimeout(350);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  const ran = await page.evaluate(() => window.__pageHandlerRan);
  let ok = got === c.expect;
  if (c.blockedHandler && ran === c.blockedHandler) ok = false;
  if (c.ranHandler && ran !== c.ranHandler) ok = false;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) {
    console.log('  expected:', JSON.stringify(c.expect), '| page handler:', JSON.stringify(ran));
    console.log('  got     :', JSON.stringify(got));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('channels hit:', await page.evaluate(() => JSON.stringify(window.__xcs && window.__xcs.state().hits)));

await browser.close();
server.close();
process.exit(fail ? 1 : 0);
