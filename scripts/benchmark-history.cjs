'use strict';
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
// Usage: node scripts/benchmark-history.cjs /path/to/baseline/src
// Pure history transforms only; browser messaging/storage costs are excluded.
const path = require('node:path');
if (!process.argv[2]) throw new Error('Provide the baseline source directory');
const before = require(path.resolve(process.argv[2], 'history-store.js'));
const after = require(path.resolve(__dirname, '../src/history-store.js'));
const BATCHES_PER_ROUND = 200;
const SAMPLES = 9;
const makeEvent = (id, kept = false) => ({site: 'x', outcome: kept ? 'kept' : 'hidden', url: `https://x.com/author/status/${id}`,
  title: `Post ${id}`, reason: kept ? 'high-like-ratio' : 'low-views', ...(kept ? {bypassedReason: 'low-views'} : {}), views: 500, likes: kept ? 10 : 0, bookmarks: null});
let history;
for (let first = 1; first <= 500; first += 50) {
  const events = Array.from({length: 50}, (_, index) => first + index).flatMap((id) => [makeEvent(id), makeEvent(id, true)]);
  history = before.addEvents(history, events, 'x', first).history;
}
const batches = Array.from({length: 10}, (_, batch) => Array.from({length: 100}, (_, index) => makeEvent((batch * 50 + index) % 550 + 1, index % 2 === 0)));
for (const batch of batches) assert.deepEqual(after.addEvents(history, batch, 'x', 1000), before.addEvents(history, batch, 'x', 1000));
function round(store) {
  const start = performance.now();
  for (let index = 0; index < BATCHES_PER_ROUND; index++) store.addEvents(history, batches[index % batches.length], 'x', 1000);
  return performance.now() - start;
}
round(before); round(after);
const samples = {before: [], after: []};
for (let index = 0; index < SAMPLES; index++) {
  for (const name of index % 2 ? ['after', 'before'] : ['before', 'after']) samples[name].push(round(name === 'before' ? before : after));
}
const nativeURL = globalThis.URL;
let constructions = 0;
globalThis.URL = class extends nativeURL {constructor(...args) {super(...args); constructions++;}};
const urlConstructions = {};
for (const [name, store] of [['before', before], ['after', after]]) {
  constructions = 0;
  store.addEvents(history, batches[0], 'x', 1000);
  urlConstructions[name] = constructions;
}
globalThis.URL = nativeURL;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({
  node: process.version, platform: process.platform, architecture: process.arch,
  workload: '200 batches of 100 X events; every batch starts with 500 hidden and 500 kept entries; mixed existing and newly seen canonical URLs',
  sampleCount: SAMPLES, executionOrder: 'alternating before/after then after/before',
  outputEquality: 'all 10 representative batch outputs deep-equal',
  medianMilliseconds: {before: median(samples.before), after: median(samples.after)}, samples, urlConstructionsPerBatch: urlConstructions,
}, null, 2));
