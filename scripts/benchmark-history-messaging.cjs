'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const vm = require('node:vm');
const store = require('../src/history-store.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASELINE_REF = '5608ce4';
const SAMPLE_COUNT = 5;
const FIXED_TIME = 1_000_000;
const RECORD = 'minimum-views-filter:record-filtered';
const SOURCE_FILES = ['settings.js', 'history-store.js', 'background.js'];
const SCENARIOS = [
  {name: 'one event in one message', messages: 1, items: 1, bursts: 20},
  {name: 'four YouTube videos in four immediate messages', messages: 4, items: 1, bursts: 20, youtubeOnly: true},
  {name: '32 events across tabs/sites/outcomes', messages: 32, items: 1, bursts: 10},
  {name: 'four full 100-item messages', messages: 4, items: 100, bursts: 10},
];
const baselineRef = process.argv[2] || DEFAULT_BASELINE_REF;
// A supplied checkout avoids spawning git in restricted benchmark environments.
const baselineDirectory = process.argv[3] ? path.resolve(process.argv[3]) : null;
const clone = (value) => JSON.parse(JSON.stringify(value));
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

function makeEvent(index, outcomeIndex) {
  const site = outcomeIndex === 1 ? 'youtube' : 'x';
  const outcome = outcomeIndex === 2 ? 'kept' : outcomeIndex === 3 ? 'highlighted' : 'hidden';
  return {
    site, outcome,
    url: site === 'x' ? `https://x.com/author/status/${index}` : `https://www.youtube.com/watch?v=${index}`,
    title: `Synthetic ${outcome} item ${index}`, views: 999, likes: 30, bookmarks: 20, replies: 10,
    reason: outcome === 'kept' ? 'high-like-ratio' : outcome === 'highlighted' ? 'high-bookmark-ratio' : 'low-views',
    ...(outcome === 'kept' ? {bypassedReason: 'low-views'} : {}),
  };
}

/** Fill each of the three separately bounded histories before measuring. */
function populatedHistory() {
  let history = store.emptyHistory();
  for (const outcome of [0, 2, 3]) {
    for (let offset = 0; offset < store.MAX_ENTRIES; offset += store.MAX_BATCH_ITEMS) {
      const items = Array.from({length: store.MAX_BATCH_ITEMS}, (_, index) => makeEvent(offset + index + 1, outcome));
      history = store.addEvents(history, items, 'x', FIXED_TIME).history;
    }
  }
  return history;
}

function loadSources(ref) {
  return Object.fromEntries(SOURCE_FILES.map((file) => [file, ref
    ? baselineDirectory ? readFileSync(path.join(baselineDirectory, 'src', file), 'utf8')
      : execFileSync('git', ['show', `${ref}:src/${file}`], {cwd: PROJECT_ROOT, encoding: 'utf8'})
    : readFileSync(path.join(PROJECT_ROOT, 'src', file), 'utf8')]));
}

/**
 * Use actual background listeners and JSON copies at the storage boundary.
 *
 * Storage resolves asynchronously with no artificial latency. The byte count
 * measures history serialized for local reads/writes, not browser RAM or IPC.
 */
function openBackground(sources, seed) {
  let listener;
  let history = clone(seed);
  const counts = {syncReads: 0, localReads: 0, localWrites: 0, historyApplications: 0, serializedHistoryBytes: 0};
  const copyHistory = (value) => {
    const serialized = JSON.stringify(value);
    counts.serializedHistoryBytes += Buffer.byteLength(serialized);
    return JSON.parse(serialized);
  };
  const api = {
    runtime: {
      id: 'benchmark', getURL: (name) => `chrome-extension://benchmark/${name}`,
      onMessage: {addListener: (callback) => {listener = callback;}},
      onInstalled: {addListener() {}}, onStartup: {addListener() {}},
    },
    contextMenus: {onClicked: {addListener() {}}},
    storage: {
      sync: {get: async () => {counts.syncReads++; return {statisticsEnabled: true};}},
      local: {
        get: async () => {counts.localReads++; return {filterHistory: copyHistory(history)};},
        set: async ({filterHistory}) => {counts.localWrites++; history = copyHistory(filterHistory);},
      },
    },
  };
  class FixedDate extends Date {static now() {return FIXED_TIME;}}
  const context = vm.createContext({URL, Date: FixedDate, setTimeout, clearTimeout, chrome: api});
  context.importScripts = (name) => {
    vm.runInContext(sources[name], context);
    if (name === 'history-store.js') {
      const historyApi = context.MinimumViewsHistory;
      // Both public entry points normalize history once per invocation.
      for (const name of ['addEvents', 'addEventBatches']) {
        if (!historyApi[name]) continue;
        const apply = historyApi[name];
        historyApi[name] = (...args) => {counts.historyApplications++; return apply(...args);};
      }
    }
  };
  vm.runInContext(sources['background.js'], context);
  return {
    counts, snapshot: () => history,
    record(items, tabId) {
      const site = items[0].site;
      const sender = {id: 'benchmark', tab: {id: tabId}, frameId: 0,
        url: site === 'x' ? 'https://x.com/home' : 'https://www.youtube.com/'};
      return new Promise((resolve) => {
        assert.equal(listener({type: RECORD, items}, sender, resolve), true);
      });
    },
  };
}

async function measure(sources, seed, scenario) {
  const background = openBackground(sources, seed);
  const bursts = Array.from({length: scenario.bursts}, (_, burstIndex) =>
    Array.from({length: scenario.messages}, (_, messageIndex) =>
      Array.from({length: scenario.items}, (_, itemIndex) => makeEvent(
        10_000 + (burstIndex * scenario.messages + messageIndex) * scenario.items + itemIndex,
        scenario.youtubeOnly ? 1 : messageIndex % 4))));
  global.gc?.();
  const started = performance.now();
  for (const messages of bursts) {
    const results = await Promise.all(messages.map((items, index) => background.record(items, index + 1)));
    assert.ok(results.every((result) => result.ok && result.recorded === scenario.items));
  }
  return {elapsedMs: performance.now() - started, counts: {...background.counts}, history: background.snapshot()};
}

async function main() {
  const sources = {baseline: loadSources(baselineRef), current: loadSources()};
  const seed = populatedHistory();
  const output = {
    baselineRef, samples: SAMPLE_COUNT,
    conditions: 'Synthetic Node VM; three 500-entry histories; asynchronous JSON-copy storage with no artificial latency. No browser memory or wall-clock claim.',
    results: [],
  };
  for (const scenario of SCENARIOS) {
    // Warm both source versions before interleaved measured samples.
    await measure(sources.baseline, seed, scenario);
    await measure(sources.current, seed, scenario);
    const samples = {baseline: [], current: []};
    for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
      const order = sample % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
      const results = {};
      for (const version of order) {
        results[version] = await measure(sources[version], seed, scenario);
        samples[version].push(results[version].elapsedMs);
      }
      assert.deepEqual(results.current.history, results.baseline.history, `${scenario.name}: final snapshots differ`);
      if (sample === 0) {
        output.results.push({scenario, snapshotEqual: true, baseline: {counts: results.baseline.counts}, current: {counts: results.current.counts}});
      } else {
        const previous = output.results.at(-1);
        assert.deepEqual(results.baseline.counts, previous.baseline.counts);
        assert.deepEqual(results.current.counts, previous.current.counts);
      }
    }
    const row = output.results.at(-1);
    for (const version of ['baseline', 'current']) {
      row[version].medianElapsedMs = Number(median(samples[version]).toFixed(2));
      row[version].elapsedMsSamples = samples[version].map((value) => Number(value.toFixed(2)));
    }
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {process.stderr.write(`${error.stack}\n`); process.exitCode = 1;});
