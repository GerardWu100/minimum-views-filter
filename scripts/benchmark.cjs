'use strict';

/**
 * Compare real content-script work on bounded synthetic feeds in jsdom.
 *
 * Usage: node scripts/benchmark.cjs [--source path/to/src]
 *          [--baseline path/to/baseline/src] [--cards 200] [--batches 20]
 *
 * Source directories contain settings.js, filter-core.js, and content.js. No
 * Git subprocess, network request, or browser installation is performed. Native
 * MutationObserver delivers actual records at microtask checkpoints. Only the
 * timer scheduler is replaced: pending production timeout callbacks are drained
 * without the artificial throttle delay, and intervals are retained for counts.
 * Timings sum synchronous production startup, observer, event, storage-change,
 * and timer callback work; they exclude fixture creation/mutation, assertions,
 * and waits. Nested timed calls are counted only once. Adapter counters include
 * getCards calls plus the subset rooted at document. These are workload proxies,
 * not browser speed, CPU utilization, browser memory, or background energy use.
 * One run is deliberately bounded; timings are illustrative and noisy. Compare
 * operation counts first, and repeat runs before making timing claims.
 */
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {JSDOM} = require('jsdom');

const DEFAULT_CARD_COUNT = 200;
const DEFAULT_BATCH_COUNT = 20;
const NEW_CARDS_PER_BATCH = 4;
const MAX_FLUSH_ROUNDS = 100;
const SETTLED_CHECKPOINTS = 3;
const HIDDEN_ATTRIBUTE = 'data-minimum-views-hidden';
const SOURCE_FILES = ['settings.js', 'filter-core.js', 'content.js'];
const INITIAL_COUNTS = [999, 1000, null, 2500];

function parseArguments() {
  const options = {source: path.resolve(__dirname, '../src'), cards: DEFAULT_CARD_COUNT, batches: DEFAULT_BATCH_COUNT};
  for (let index = 2; index < process.argv.length; index += 2) {
    const option = process.argv[index];
    const value = process.argv[index + 1];
    if (!['--source', '--baseline', '--cards', '--batches'].includes(option) || !value) {
      throw new Error('Usage: node scripts/benchmark.cjs [--source src] [--baseline src] [--cards N] [--batches N]');
    }
    const key = option.slice(2);
    options[key] = ['cards', 'batches'].includes(key) ? Number(value) : path.resolve(value);
  }
  for (const key of ['cards', 'batches']) assert.ok(Number.isSafeInteger(options[key]) && options[key] > 0, `${key} must be a positive integer`);
  return options;
}

function cardMarkup(site, id, views) {
  const count = views === null ? '' : String(views);
  if (site === 'x') return `<div data-testid="cellInnerDiv" id="card-${id}"><article data-testid="tweet"><a href="/author/status/${id}"><time>Now</time></a><div data-testid="tweetText">Synthetic post</div>${views === null ? '' : `<a data-count href="/author/status/${id}/analytics" aria-label="${count} views">${count}</a>`}</article></div>`;
  return `<ytd-rich-item-renderer id="card-${id}"><ytd-rich-grid-media><a id="video-title" href="/watch?v=${id}">Synthetic video</a><ytd-channel-name><a href="/@author">Creator</a></ytd-channel-name><div id="metadata-line">${views === null ? '' : `<span data-count>${count} views</span>`}<span>1 hour ago</span></div></ytd-rich-grid-media></ytd-rich-item-renderer>`;
}

/**
 * Execute actual runtime sources with observable scheduler and adapter calls.
 *
 * Parameters
 * ----------
 * sourceDirectory : string
 *     Directory containing the three unmodified runtime JavaScript files.
 * site : 'x' | 'youtube'
 *     YouTube uses watch recommendations next to a synthetic active player.
 * cardCount, batchCount : positive integer
 *     Initial feed size and separately delivered mutation batches per scenario.
 *
 * Returns
 * -------
 * Promise<Array<object>>
 *     Scenario rows with additive callback milliseconds and operation counts,
 *     plus final active observer/interval counts. Every batch checks expected
 *     marks on all connected fixture cards; mismatch rejects the benchmark.
 */
async function benchmarkSite(sourceDirectory, site, cardCount, batchCount) {
  const expectedCounts = new Map(Array.from({length: cardCount}, (_, id) => [id, INITIAL_COUNTS[id % INITIAL_COUNTS.length]]));
  const cards = [...expectedCounts].map(([id, count]) => cardMarkup(site, id, count)).join('');
  const feed = `<div id="feed">${cards}</div>`;
  const html = `<aside id="sidebar"><span>Unrelated navigation</span></aside>${site === 'youtube' ? `<ytd-watch-flexy><div id="movie_player"><video></video><span>0:00</span></div><div id="related">${feed}</div></ytd-watch-flexy>` : feed}`;
  const dom = new JSDOM(html, {url: site === 'x' ? 'https://x.com/home' : 'https://www.youtube.com/watch?v=playing', runScripts: 'outside-only', pretendToBeVisual: true});
  const {window} = dom;
  const {document} = window;
  // Finish jsdom document loading before production listeners are installed;
  // otherwise a synthetic pageshow can nondeterministically add a startup scan.
  if (document.readyState !== 'complete') await new Promise((resolve) => window.addEventListener('load', resolve, {once: true}));
  const timeouts = new Map();
  const intervals = new Map();
  const storageListeners = new Set();
  const observers = new Set();
  let nextTimer = 1;
  let hidden = false;
  let timingDepth = 0;
  let totals = emptyTotals();
  const rows = [];
  const nativeObserver = window.MutationObserver;

  function emptyTotals() {
    return {runtimeWorkMs: 0, getCards: 0, documentGetCards: 0, getViewCount: 0, getCreatorIdentifiers: 0, observerCallbacks: 0, timeoutCallbacks: 0};
  }
  function timed(callback, receiver, argumentsList) {
    const outermost = timingDepth++ === 0;
    const started = outermost ? performance.now() : 0;
    try { return callback.apply(receiver, argumentsList); }
    finally {
      timingDepth--;
      if (outermost) totals.runtimeWorkMs += performance.now() - started;
    }
  }
  Object.defineProperties(document, {
    hidden: {configurable: true, get: () => hidden},
    visibilityState: {configurable: true, get: () => hidden ? 'hidden' : 'visible'},
  });
  window.setTimeout = (callback, delay, ...args) => {
    assert.equal(typeof callback, 'function');
    const timer = nextTimer++;
    timeouts.set(timer, {callback, args});
    return timer;
  };
  window.clearTimeout = (timer) => timeouts.delete(timer);
  window.setInterval = (callback) => {
    const timer = nextTimer++;
    intervals.set(timer, callback);
    return timer;
  };
  window.clearInterval = (timer) => intervals.delete(timer);
  window.MutationObserver = class extends nativeObserver {
    constructor(callback) {
      super((...args) => {
        totals.observerCallbacks++;
        timed(callback, this, args);
      });
    }
    observe(...args) { super.observe(...args); observers.add(this); }
    disconnect() { super.disconnect(); observers.delete(this); }
  };
  window.browser = {storage: {
    local: {get: () => ({then(callback) {
      // Measure the real startup scan inside the production storage continuation.
      return Promise.resolve({[site + 'Whitelist']: [site === 'x' ? 'exempt' : '@exempt']})
        .then((stored) => timed(callback, undefined, [stored]));
    }})},
    onChanged: {addListener: (callback) => storageListeners.add(callback), removeListener: (callback) => storageListeners.delete(callback)},
  }};

  async function flush() {
    let idleRounds = 0;
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
      // Awaiting lets native DOM mutation delivery and startup promises run.
      await Promise.resolve();
      if (!timeouts.size) {
        if (++idleRounds >= SETTLED_CHECKPOINTS) return;
        continue;
      }
      idleRounds = 0;
      for (const [timer, task] of [...timeouts]) {
        if (!timeouts.delete(timer)) continue;
        totals.timeoutCallbacks++;
        timed(task.callback, window, task.args);
      }
    }
    throw new Error('Production callbacks failed to settle within the bounded scheduler');
  }
  function assertMarks(enabled = true) {
    let expectedHidden = 0;
    for (const [id, count] of expectedCounts) {
      const expected = enabled && count !== null && count < 1000;
      expectedHidden += Number(expected);
      assert.equal(document.getElementById(`card-${id}`).hasAttribute(HIDDEN_ATTRIBUTE), expected, `${site} card ${id}`);
    }
    assert.equal(document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`).length, expectedHidden, 'No unrelated element is hidden');
  }
  async function scenario(name, action, enabled = true) {
    totals = emptyTotals();
    await action();
    await flush();
    assertMarks(enabled);
    rows.push({site, scenario: name, ...totals, runtimeWorkMs: Number(totals.runtimeWorkMs.toFixed(3)), activeObservers: observers.size, activeIntervals: intervals.size});
  }
  function changeSettings(values) {
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, {newValue}]));
    for (const listener of storageListeners) timed(listener, undefined, [changes, 'local']);
  }
  function dispatch(target, event) { timed(target.dispatchEvent, target, [event]); }
  async function noise(enabled = true) {
    for (let batch = 0; batch < batchCount; batch++) {
      const sidebar = document.querySelector('#sidebar span');
      sidebar.firstChild.data = `Navigation ${batch}`;
      sidebar.className = `sidebar-state-${batch % 2}`;
      const player = document.querySelector('#movie_player span');
      if (player) player.firstChild.data = `0:${batch}`;
      await flush();
      assertMarks(enabled);
    }
  }

  try {
    await scenario('startup', async () => {
      for (const file of SOURCE_FILES) {
        window.eval(readFileSync(path.join(sourceDirectory, file), 'utf8'));
        if (file === 'filter-core.js') {
          const core = window.MinimumViewsCore;
          for (const name of ['getCards', 'getViewCount', 'getCreatorIdentifiers']) {
            const original = core[name];
            core[name] = function (...args) {
              totals[name]++;
              if (name === 'getCards' && args[0] === document) totals.documentGetCards++;
              return original.apply(this, args);
            };
          }
        }
      }
    });
    await scenario('unrelated-sidebar-player-noise', () => noise());
    await scenario('one-card-count-changes', async () => {
      for (let batch = 0; batch < batchCount; batch++) {
        const count = batch % 2 === 0 ? 2000 : 100;
        const metadata = document.querySelector('#card-0 [data-count]');
        if (site === 'x') metadata.setAttribute('aria-label', `${count} views`);
        else metadata.firstChild.data = `${count} views`;
        expectedCounts.set(0, count);
        await flush();
        assertMarks();
      }
    });
    await scenario('new-card-batches', async () => {
      for (let batch = 0; batch < batchCount; batch++) {
        const added = [];
        for (let offset = 0; offset < NEW_CARDS_PER_BATCH; offset++) {
          const id = expectedCounts.size;
          const count = INITIAL_COUNTS[offset % INITIAL_COUNTS.length];
          expectedCounts.set(id, count);
          added.push(cardMarkup(site, id, count));
        }
        document.getElementById('feed').insertAdjacentHTML('beforeend', added.join(''));
        await flush();
        assertMarks();
      }
    });
    hidden = true;
    dispatch(document, new window.Event('visibilitychange'));
    await flush();
    await scenario('hidden-tab-noise', () => noise());
    await scenario('visible-tab-return', async () => {
      hidden = false;
      dispatch(document, new window.Event('visibilitychange'));
    });
    changeSettings({[site + 'Enabled']: false});
    await flush();
    assertMarks(false);
    await scenario('disabled-site-noise', () => noise(false), false);
    changeSettings({[site + 'Enabled']: true});
    await flush();
    assertMarks();
    window.history.pushState({}, '', site === 'x' ? '/search?q=synthetic' : '/results?search_query=synthetic');
    dispatch(window, new window.PopStateEvent('popstate'));
    await flush();
    assertMarks(false);
    await scenario('excluded-route-noise', () => noise(false), false);
    return rows;
  } finally {
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: false}));
    window.close();
  }
}

async function main() {
  const options = parseArguments();
  const results = [];
  const sources = options.baseline ? [['baseline', options.baseline], ['current', options.source]] : [['current', options.source]];
  for (const [version, directory] of sources) {
    for (const site of ['x', 'youtube']) {
      for (const row of await benchmarkSite(directory, site, options.cards, options.batches)) results.push({version, ...row});
    }
  }
  console.log(JSON.stringify({
    environment: {node: process.version, jsdom: require('jsdom/package.json').version},
    fixture: {initialCards: options.cards, mutationBatches: options.batches, newCardsPerBatch: NEW_CARDS_PER_BATCH},
    sources: Object.fromEntries(sources),
    timingScope: 'Synchronous production callback work in jsdom; excludes throttle waits, fixture writes, setup, and assertions. Not browser CPU, memory, or speed. Timing is noisy; operation counts are deterministic.',
    correctness: 'All expected hidden marks checked after every mutation batch and scenario.',
    results,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
