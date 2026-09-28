'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
// Usage: node scripts/benchmark-engagement.cjs /path/to/baseline/src
// Synthetic DOM parsing only; this does not measure browser CPU or RAM.
const workspace = path.resolve(__dirname, '..');
const {JSDOM} = require('jsdom');
if (!process.argv[2]) throw new Error('Provide the baseline source directory');
const baseline = require(path.resolve(process.argv[2], 'filter-core.js'));
const candidate = require(path.join(workspace, 'src/filter-core.js'));
const CARD_COUNT = 200;
const PASSES = 20;
const SAMPLES = 7;
const dom = new JSDOM(Array.from({length: CARD_COUNT}, (_, index) => `<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/author">Author</a><a href="/author/status/${index}"><time>Now</time></a></div>
  <div data-testid="tweetText">Synthetic post</div>
  <div role="link"><div role="group" aria-label="999,999 likes, 999,999 bookmarks, 1M views"></div></div>
  <a href="/author/status/${index}/analytics" aria-label="100,000 views">100K</a>
  <div role="group" aria-label="3 replies, 5 reposts, 1,234 likes, 50 bookmarks, 100,000 views">
    <button data-testid="like" aria-label="1.2K Likes. Like">1.2K</button>
    <button data-testid="bookmark" aria-label="50 Bookmarks. Bookmark">50</button>
  </div></article>`).join(''));
const cards = [...dom.window.document.querySelectorAll('article')];
let queries = 0;
const prototype = dom.window.Element.prototype;
const original = prototype.querySelectorAll;
prototype.querySelectorAll = function (...args) {queries++; return original.apply(this,args);};
function run(core) {
  queries = 0;
  let checksum = 0;
  const started = performance.now();
  for (let pass=0;pass<PASSES;pass++) for (const card of cards) {
    const result = core.getXEngagement(card);
    checksum += result.likes + result.bookmarks;
  }
  const elapsed = performance.now()-started;
  assert.equal(checksum, CARD_COUNT * PASSES * (1234 + 50));
  return {elapsedMs: Number(elapsed.toFixed(2)), queries};
}
// Warm both selector paths, then alternate sample order to reduce order effects.
run(baseline); run(candidate);
const samples = {baseline: [], candidate: []};
for (let sample=0;sample<SAMPLES;sample++) for (const name of sample%2 ? ['candidate','baseline'] : ['baseline','candidate']) {
  samples[name].push(run(name==='candidate'?candidate:baseline));
}
for (const [name, rows] of Object.entries(samples)) {
  const times=rows.map(row=>row.elapsedMs).sort((a,b)=>a-b);
  console.log(JSON.stringify({name,cards:CARD_COUNT,passes:PASSES,samples:rows,medianMs:times[Math.floor(times.length/2)]}));
}
dom.window.close();
