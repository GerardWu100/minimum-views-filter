'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const store = require('../src/history-store.js');

const source = (name) => readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
// Site totals derived from per-reason counts, e.g. {x: 3, youtube: 0}.
const totals = (history) => ({x: store.siteTotal(history.counts.x), youtube: store.siteTotal(history.counts.youtube)});
const popupSender = {id: 'extension-id', url: 'chrome-extension://extension-id/popup.html'};
const xSender = {id: 'extension-id', tab: {id: 1}, frameId: 0, url: 'https://x.com/home'};
const youtubeSender = {id: 'extension-id', tab: {id: 2}, frameId: 0, url: 'https://www.youtube.com/watch?v=active'};
const pageSender = {id: 'extension-id', url: 'chrome-extension://extension-id/history.html'};
const xEvent = (id, extra = {}) => ({site: 'x', outcome: 'hidden', url: `https://x.com/Author/status/${id}`, title: `Post ${id}`, reason: 'low-views', views: 999, likes: null, bookmarks: null, ...extra});
const youtubeEvent = (id, extra = {}) => ({site: 'youtube', outcome: 'hidden', url: `https://www.youtube.com/watch?v=${id}`, title: `Video ${id}`, reason: 'low-views', views: 999, likes: null, bookmarks: null, ...extra});

function openBackground({style = 'chrome', get, set, syncGet} = {}) {
  const onMessage = {listeners: [], addListener(listener) {this.listeners.push(listener);}};
  let stored = {};
  const local = {
    get: get || (async () => clone(stored)),
    set: set || (async (update) => {stored = {...stored, ...clone(update)};}),
  };
  const api = {
    runtime: {id: 'extension-id', onMessage, onInstalled: {addListener() {}}, onStartup: {addListener() {}},
      getURL: (name) => `chrome-extension://extension-id/${name}`},
    storage: {local, sync: {get: syncGet || (async () => ({}))}},
    contextMenus: {onClicked: {addListener() {}}},
  };
  const context = vm.createContext({URL, setTimeout, clearTimeout, Date});
  context.globalThis = context;
  context[style === 'chrome' ? 'chrome' : 'browser'] = api;
  if (style === 'chrome') context.importScripts = (name) => vm.runInContext(source(name), context);
  else {
    vm.runInContext(source('settings.js'), context);
    vm.runInContext(source('history-store.js'), context);
  }
  vm.runInContext(source('background.js'), context);
  return {
    api,
    read: () => clone(stored.filterHistory),
    send(message, sender) {
      return new Promise((resolve) => {
        const keptOpen = onMessage.listeners[0](message, sender, resolve);
        assert.equal(keptOpen, true);
      });
    },
  };
}

test('canonical URL validation excludes redirects, foreign sites, credentials, and duplicate video IDs', () => {
  assert.equal(store.canonicalItemUrl('https://twitter.com/Author/status/123?x=1', 'x'), 'https://x.com/author/status/123');
  assert.equal(store.canonicalItemUrl('https://x.com/i/status/123/analytics', 'x'), null);
  assert.equal(store.canonicalItemUrl('https://www.youtube.com/watch?feature=share&v=Ab_9', 'youtube'), 'https://www.youtube.com/watch?v=Ab_9');
  assert.equal(store.canonicalItemUrl('https://x.com/author/status/123\n', 'x'), 'https://x.com/author/status/123');
  assert.equal(store.canonicalItemUrl('https://www.youtube.com/watch?v=Ab_9\r\n', 'youtube'), 'https://www.youtube.com/watch?v=Ab_9');
  for (const unsafe of ['javascript:alert(1)', 'https://x.com.evil.org/a/status/1', 'https://user@x.com/a/status/1',
    'http://x.com/a/status/1', 'https://www.youtube.com/watch?v=one&v=two']) {
    assert.equal(store.canonicalItemUrl(unsafe, unsafe.includes('youtube') ? 'youtube' : 'x'), null);
  }
});

test('history caps recent links and deduplicates repeat appearances while preserving total events', () => {
  let history = store.emptyHistory();
  for (let id = 1; id <= 510; id++) history = store.addEvents(history, [xEvent(id)], 'x', id).history;
  assert.equal(store.siteTotal(history.counts.x), 510);
  assert.equal(history.entries.length, 500);
  assert.equal(history.entries[0].url, 'https://x.com/author/status/510');
  assert.equal(history.entries.at(-1).url, 'https://x.com/author/status/11');
  const repeated = store.addEvents(history, [xEvent(42, {title: 'Updated'})], 'x', 999).history;
  assert.equal(store.siteTotal(repeated.counts.x), 511);
  assert.equal(repeated.entries.length, 500);
  assert.equal(repeated.entries[0].title, 'Updated');
  assert.equal(repeated.entries[0].events, 2);
  assert.equal(repeated.entries.filter((entry) => entry.url.endsWith('/42')).length, 1);
  assert.equal(store.addEvents(repeated, [xEvent(1, {url: null})], 'x', 1000).history.entries.length, 500);
});

test('malformed batches and unsafe fields cannot bloat storage or increment counts', () => {
  assert.equal(store.addEvents(null, Array(101).fill(xEvent(1)), 'x', 1), null);
  const result = store.addEvents(null, [
    xEvent(1, {title: '<img onerror=alert(1)>'}),
    xEvent(2, {url: 'https://evil.example/'}),
    xEvent(3, {views: 1e18}),
    xEvent(4, {site: 'youtube'}),
    xEvent(5, {url: null, title: 'No permalink'}),
    xEvent(6, {title: 'x'.repeat(500)}),
  ], 'x', 1);
  assert.equal(result.recorded, 2);
  assert.equal(result.history.entries.length, 1);
  assert.equal(store.siteTotal(result.history.counts.x), 2);
  assert.equal(store.normalizeEvent(xEvent(1, {title: 'x'.repeat(500)}), 'x'), null);
  assert.equal(store.normalizeEvent(xEvent(1, {enrich: 'yes'}), 'x'), null);
  assert.equal(store.normalizeEvent(xEvent(1, {enrich: true, url: null}), 'x'), null);
});

test('history rejects site-specific reasons and snapshots that cannot establish their outcome', () => {
  const invalidHidden = [
    xEvent(1, {reason: 'low-views', views: null}),
    xEvent(2, {reason: 'unknown-views', views: 1}),
    xEvent(3, {reason: 'low-like-ratio', views: 0, likes: 0}),
    xEvent(4, {reason: 'low-like-ratio', views: 1000, likes: null}),
  ];
  const invalidKept = [
    keptEvent(5, {views: null}), keptEvent(6, {views: 0}), keptEvent(7, {likes: null}),
    keptEvent(8, {reason: 'high-bookmark-ratio', bookmarks: null}),
    keptEvent(9, {reason: 'high-bookmark-ratio', bookmarks: 1, bypassedReason: 'low-like-ratio', likes: null}),
  ];
  assert.equal(store.addEvents(null, [...invalidHidden, ...invalidKept], 'x', 1).recorded, 0);
  assert.equal(store.addEvents(null, [youtubeEvent('a', {reason: 'low-like-ratio', likes: 0})], 'youtube', 1).recorded, 0);
  const valid = store.addEvents(null, [
    xEvent(10, {views: 0}), xEvent(11, {reason: 'unknown-views', views: null}),
    xEvent(12, {reason: 'low-like-ratio', views: 1, likes: 0}),
    keptEvent(13, {likes: 0}), keptEvent(14, {reason: 'high-bookmark-ratio', bookmarks: 0}),
  ], 'x', 1);
  assert.equal(valid.recorded, 5, 'zero numerators are known and may satisfy a configured zero-percent exception');
  const corrupt = store.normalizeHistory({entries: invalidHidden, keptEntries: invalidKept, counts: {youtube: {'low-like-ratio': 7}}});
  assert.equal(corrupt.entries.length, 0);
  assert.equal(corrupt.keptEntries.length, 0);
  assert.equal(store.siteTotal(corrupt.counts.youtube), 0);
});

test('a later permalink enriches a linkless hide without counting a second hide event', () => {
  const initial = store.addEvents(null, [xEvent(1, {url: null})], 'x', 100);
  assert.equal(initial.recorded, 1);
  assert.equal(store.siteTotal(initial.history.counts.x), 1);
  assert.equal(initial.history.entries.length, 0);
  const enriched = store.addEvents(initial.history, [xEvent(1, {enrich: true})], 'x', 200);
  assert.equal(enriched.recorded, 1);
  assert.equal(store.siteTotal(enriched.history.counts.x), 1);
  assert.equal(enriched.history.entries.length, 1);
  assert.equal(enriched.history.entries[0].events, 1);
  assert.equal(enriched.history.entries[0].lastFilteredAt, 200);
  assert.equal(Object.hasOwn(enriched.history.entries[0], 'enrich'), false);
  const laterAppearance = store.addEvents(enriched.history, [xEvent(1)], 'x', 300);
  assert.equal(store.siteTotal(laterAppearance.history.counts.x), 2);
  assert.equal(laterAppearance.history.entries[0].events, 2);
});

for (const style of ['chrome', 'firefox']) {
  test(`${style}: background rejects impossible history outcomes without writing storage`, async () => {
    const app = openBackground({style});
    const type = 'minimum-views-filter:record-filtered';
    for (const [sender, item] of [
      [xSender, keptEvent(1, {likes: null})],
      [youtubeSender, youtubeEvent('a', {reason: 'low-like-ratio', likes: 0})],
    ]) assert.deepEqual(clone(await app.send({type, items: [item]}, sender)), {ok: false, error: 'invalid-message'});
    assert.equal(app.read(), undefined);
  });

  test(`${style}: background counts permalink enrichment as accepted without increasing total`, async () => {
    const app = openBackground({style});
    const type = 'minimum-views-filter:record-filtered';
    assert.deepEqual(clone(await app.send({type, items: [xEvent(1, {url: null})]}, xSender)), {ok: true, recorded: 1});
    assert.deepEqual(clone(await app.send({type, items: [xEvent(1, {enrich: true})]}, xSender)), {ok: true, recorded: 1});
    assert.deepEqual(totals(app.read()), {x: 1, youtube: 0});
    assert.equal(app.read().entries[0].events, 1);
  });

  test(`${style}: concurrent X and YouTube messages serialize and clear is ordered`, async () => {
    const app = openBackground({style});
    const messages = [];
    for (let id = 1; id <= 20; id++) {
      messages.push(app.send({type: 'minimum-views-filter:record-filtered', items: [xEvent(id)]}, xSender));
      messages.push(app.send({type: 'minimum-views-filter:record-filtered', items: [youtubeEvent(id)]}, youtubeSender));
    }
    assert.equal((await Promise.all(messages)).every((response) => response.ok), true);
    let response = await app.send({type: 'minimum-views-filter:get-history'}, pageSender);
    assert.deepEqual(totals(response.history), {x: 20, youtube: 20});
    assert.equal(response.history.entries.length, 40);
    const clear = app.send({type: 'minimum-views-filter:clear-history'}, pageSender);
    const after = app.send({type: 'minimum-views-filter:record-filtered', items: [xEvent(100)]}, xSender);
    await Promise.all([clear, after]);
    response = await app.send({type: 'minimum-views-filter:get-history'}, pageSender);
    assert.deepEqual(totals(response.history), {x: 1, youtube: 0});
    assert.equal(response.history.entries.length, 1);
  });
}

test('only verified main-frame content scripts may record; only history page may read or clear', async () => {
  const app = openBackground();
  const record = {type: 'minimum-views-filter:record-filtered', items: [xEvent(1)]};
  for (const sender of [
    {...xSender, id: 'other-extension'},
    {...xSender, url: 'https://x.com/search'},
    {...xSender, url: 'https://x.com.evil.org/home'},
    {...xSender, url: 'https://x.com/home', frameId: 1},
    {...xSender, url: 'https://x.com/home', tab: null},
  ]) assert.deepEqual(clone(await app.send(record, sender)), {ok: false, error: 'forbidden'});
  assert.deepEqual(clone(await app.send(record, youtubeSender)), {ok: false, error: 'invalid-message'});
  assert.deepEqual(clone(await app.send({type: 'minimum-views-filter:get-history'}, xSender)), {ok: false, error: 'forbidden'});
  assert.deepEqual(totals((await app.send({type: 'minimum-views-filter:get-history'}, {...pageSender, tab: {id: 9}})).history), {x: 0, youtube: 0});
  assert.deepEqual(clone(await app.send({type: 'minimum-views-filter:clear-history'}, {...pageSender, url: pageSender.url + '?fake'})), {ok: false, error: 'forbidden'});
  assert.equal(app.read(), undefined);
});

test('storage failure returns a bounded error and a later operation can recover', async () => {
  let fail = true;
  let stored = {};
  const app = openBackground({
    get: async () => {if (fail) throw Error('offline'); return clone(stored);},
    set: async (update) => {if (fail) throw Error('offline'); stored = {...stored, ...clone(update)};},
  });
  const record = {type: 'minimum-views-filter:record-filtered', items: [xEvent(1)]};
  assert.deepEqual(clone(await app.send(record, xSender)), {ok: false, error: 'storage-unavailable'});
  fail = false;
  assert.deepEqual(clone(await app.send(record, xSender)), {ok: true, recorded: 1});
  assert.deepEqual(totals((await app.send({type: 'minimum-views-filter:get-history'}, pageSender)).history), {x: 1, youtube: 0});
});

function loadHistoryPageScripts(dom) {
  for (const name of ['history-store.js', 'reason-breakdown.js', 'history.js']) dom.window.eval(source(name));
}

test('history page renders titles as text and updates counters from local storage changes', async () => {
  const dom = new JSDOM(source('history.html'), {url: pageSender.url, runScripts: 'outside-only'});
  const xHistory = store.addEvents(null, [xEvent(1, {title: '<img src=x onerror=alert(1)>', views: 1000, likes: 3, bookmarks: 1})], 'x', Date.now()).history;
  const history = store.addEvents(xHistory, [youtubeEvent('yt1')], 'youtube', Date.now()).history;
  const listeners = [];
  dom.window.chrome = {runtime: {sendMessage: async ({type}) => ({ok: true, history: type.endsWith('clear-history') ? store.emptyHistory() : history})},
    storage: {onChanged: {addListener: (listener) => listeners.push(listener)}}};
  loadHistoryPageScripts(dom);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('#x-count').textContent, '1');
  const xRow = [...dom.window.document.querySelectorAll('#entries li')].find((row) => row.querySelector('a').href.includes('x.com'));
  const youtubeRow = [...dom.window.document.querySelectorAll('#entries li')].find((row) => row.querySelector('a').href.includes('youtube.com'));
  assert.equal(xRow.querySelector('a').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(dom.window.document.querySelector('#entries img'), null);
  assert.equal(xRow.querySelector('a').href, 'https://x.com/author/status/1');
  assert.match(xRow.querySelector('.entry-metrics').textContent, /Likes\/views 0\.3%/);
  assert.match(xRow.querySelector('.entry-metrics').textContent, /Bookmarks\/views 0\.1%/);
  assert.match(xRow.querySelector('.entry-meta').textContent, /Low views/);
  assert.doesNotMatch(youtubeRow.querySelector('.entry-metrics').textContent, /Likes|Bookmarks/);
  assert.ok(dom.window.document.querySelector('details.about-counts summary').textContent.includes('About these counts'));
  dom.window.document.querySelector('#clear-history').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('#x-count').textContent, '0');
  assert.equal(dom.window.document.querySelector('#entries').children.length, 0);
  listeners[0]({filterHistory: {newValue: history}}, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('#x-count').textContent, '1');
  dom.window.close();
});

test('history can clear a late enrichment entry even when reset left both totals at zero', async () => {
  const history = store.addEvents(store.emptyHistory(), [xEvent(1, {enrich: true})], 'x', 1).history;
  assert.equal(store.siteTotal(history.counts.x), 0);
  const dom = new JSDOM(source('history.html'), {url: 'https://extension.invalid/history.html', runScripts: 'outside-only'});
  dom.window.chrome = {runtime: {sendMessage: async ({type}) => ({ok: true, history: type.endsWith('clear-history') ? store.emptyHistory() : history})}, storage: {sync: {get: async () => ({})}, onChanged: {addListener() {}}}};
  loadHistoryPageScripts(dom);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('#clear-history').disabled, false);
  dom.window.document.querySelector('#clear-history').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelector('#entries').children.length, 0);
  assert.equal(dom.window.document.querySelector('#clear-history').disabled, true);
  dom.window.close();
});

test('hide events are counted per site and reason; enrichment and corrupt counts add nothing', () => {
  let history = store.addEvents(null, [
    xEvent(1), xEvent(2), xEvent(3, {reason: 'low-like-ratio', views: 5000, likes: 1}),
    xEvent(4, {reason: 'unknown-views', views: null}),
  ], 'x', 1).history;
  history = store.addEvents(history, [youtubeEvent('a', {reason: 'low-views'}), youtubeEvent('b', {reason: 'unknown-views', views: null})], 'youtube', 2).history;
  history = store.addEvents(history, [xEvent(1, {enrich: true})], 'x', 3).history;
  assert.deepEqual(clone(history.counts), {
    x: {'low-views': 2, 'low-like-ratio': 1, 'unknown-views': 1},
    youtube: {'low-views': 1, 'low-like-ratio': 0, 'unknown-views': 1},
  });
  assert.deepEqual(totals(history), {x: 4, youtube: 2});
  const corrupt = store.normalizeHistory({counts: {x: 7, youtube: {'low-views': -1, 'unknown-views': 3, invented: 9}}});
  assert.deepEqual(clone(corrupt.counts), {
    x: {'low-views': 0, 'low-like-ratio': 0, 'unknown-views': 0},
    youtube: {'low-views': 0, 'low-like-ratio': 0, 'unknown-views': 3},
  });
});

test('only the statistics page may read or reset stored history', async () => {
  const app = openBackground();
  await app.send({type: 'minimum-views-filter:record-filtered', items: [xEvent(1)]}, xSender);
  const read = await app.send({type: 'minimum-views-filter:get-history'}, pageSender);
  assert.deepEqual(totals(read.history), {x: 1, youtube: 0});
  assert.deepEqual(clone(await app.send({type: 'minimum-views-filter:get-history'}, popupSender)), {ok: false, error: 'forbidden'});
  assert.deepEqual(clone(await app.send({type: 'minimum-views-filter:clear-history'}, popupSender)), {ok: false, error: 'forbidden'});
  assert.deepEqual(totals(app.read()), {x: 1, youtube: 0});
});

test('history page shows reason breakdowns and filters recent items by site and reason', async () => {
  const dom = new JSDOM(source('history.html'), {url: pageSender.url, runScripts: 'outside-only'});
  let history = store.addEvents(null, [xEvent(1), xEvent(2), xEvent(3, {reason: 'low-like-ratio', views: 5000, likes: 1})], 'x', 1).history;
  history = store.addEvents(history, [youtubeEvent('a', {reason: 'unknown-views', views: null})], 'youtube', 2).history;
  dom.window.chrome = {runtime: {sendMessage: async () => ({ok: true, history})}, storage: {sync: {get: async () => ({})}, onChanged: {addListener() {}}}};
  loadHistoryPageScripts(dom);
  await new Promise((resolve) => setImmediate(resolve));
  const document = dom.window.document;
  const reasonRow = (site, reason) => document.querySelector(`#${site}-reasons li[data-reason="${reason}"]`);
  assert.equal(document.querySelector('#x-count').textContent, '3');
  assert.equal(reasonRow('x', 'low-views').querySelector('.reason-count').textContent, '2');
  assert.equal(reasonRow('x', 'low-views').querySelector('.reason-share').textContent, '67%');
  assert.equal(reasonRow('x', 'low-like-ratio').querySelector('.reason-count').textContent, '1');
  assert.equal(reasonRow('x', 'unknown-views').hasAttribute('data-zero'), true);
  assert.equal(reasonRow('youtube', 'low-like-ratio'), null);
  assert.equal(document.querySelectorAll('#x-reasons .stack-segment').length, 2);
  assert.equal(document.querySelectorAll('#entries li').length, 4);
  document.querySelector('#site-filter [data-value="x"]').click();
  assert.equal(document.querySelectorAll('#entries li').length, 3);
  document.querySelector('#reason-filter [data-value="low-like-ratio"]').click();
  assert.equal(document.querySelectorAll('#entries li').length, 1);
  assert.equal(document.querySelector('#reason-filter [data-value="low-like-ratio"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#recent-shown').textContent, '1 of 4 items');
  document.querySelector('#site-filter [data-value="youtube"]').click();
  assert.equal(document.querySelectorAll('#entries li').length, 0);
  assert.equal(document.querySelector('#status').textContent, 'No recent items match these filters.');
  dom.window.close();
});

const keptEvent = (id, extra = {}) => xEvent(id, {outcome: 'kept', reason: 'high-like-ratio', bypassedReason: 'low-views', views: 500, likes: 10, ...extra});
const highlightedEvent = (id, extra = {}) => xEvent(id, {outcome: 'highlighted', reason: 'high-bookmark-ratio', views: 1000, likes: null, bookmarks: 12, ...extra});

test('highlighted events keep independent totals and bounded links alongside kept posts', () => {
  let history = store.addEvents(null, [keptEvent(1, {reason: 'high-bookmark-ratio', bookmarks: 12}), highlightedEvent(1), highlightedEvent(2, {url: null})], 'x', 1).history;
  assert.equal(history.xHighlightedCount, 2);
  assert.equal(store.siteTotal(history.xKeptCounts), 1);
  assert.equal(history.keptEntries.length, 1);
  assert.equal(history.highlightedEntries.length, 1);
  assert.equal(history.highlightedEntries[0].url, history.keptEntries[0].url);
  history = store.addEvents(history, [highlightedEvent(2, {enrich: true})], 'x', 2).history;
  assert.equal(history.xHighlightedCount, 2);
  assert.equal(history.highlightedEntries[0].url, 'https://x.com/author/status/2');
  for (let id = 3; id <= 511; id++) history = store.addEvents(history, [highlightedEvent(id)], 'x', id).history;
  assert.equal(history.xHighlightedCount, 511);
  assert.equal(history.highlightedEntries.length, store.MAX_ENTRIES);
  assert.equal(history.highlightedEntries[0].url, 'https://x.com/author/status/511');
  assert.equal(history.keptEntries.length, 1);
  history = store.addEvents(history, [highlightedEvent(42, {title: 'Updated highlight'})], 'x', 512).history;
  assert.equal(history.highlightedEntries[0].title, 'Updated highlight');
  assert.equal(history.highlightedEntries[0].events, 2);
  assert.equal(history.highlightedEntries.length, store.MAX_ENTRIES);
});

test('highlight validation requires an X bookmark ratio snapshot and preserves old history', () => {
  const invalid = [
    highlightedEvent(1, {views: null}), highlightedEvent(2, {views: 0}), highlightedEvent(3, {bookmarks: null}),
    highlightedEvent(4, {reason: 'high-like-ratio'}), highlightedEvent(5, {outcome: 'hidden'}),
  ];
  assert.equal(store.addEvents(null, invalid, 'x', 1).recorded, 0);
  assert.equal(store.addEvents(null, [youtubeEvent('a', {outcome: 'highlighted', reason: 'high-bookmark-ratio', bookmarks: 1})], 'youtube', 1).recorded, 0);
  const old = store.addEvents(null, [xEvent(1)], 'x', 1).history;
  delete old.xHighlightedCount;
  delete old.highlightedEntries;
  const normalized = store.normalizeHistory(old);
  assert.equal(normalized.xHighlightedCount, 0);
  assert.deepEqual(normalized.highlightedEntries, []);
  assert.equal(normalized.entries.length, 1);
  assert.equal(store.normalizeHistory({xHighlightedCount: -1, highlightedEntries: [xEvent(1)]}).xHighlightedCount, 0);
});

test('paused collection rejects queued writes while retaining readable statistics and allowing reset', async () => {
  let enabled = true;
  let releaseFirstRead;
  let syncReads = 0;
  const firstRead = new Promise((resolve) => {releaseFirstRead = resolve;});
  const app = openBackground({syncGet: async () => {
    syncReads++;
    if (syncReads === 1) { await firstRead; return {statisticsEnabled: true}; }
    return {statisticsEnabled: enabled};
  }});
  const type = 'minimum-views-filter:record-filtered';
  const first = app.send({type, items: [highlightedEvent(1)]}, xSender);
  const queued = app.send({type, items: [highlightedEvent(2)]}, xSender);
  enabled = false;
  releaseFirstRead();
  assert.deepEqual(clone(await first), {ok: true, recorded: 1});
  assert.deepEqual(clone(await queued), {ok: true, recorded: 0});
  assert.equal(app.read().xHighlightedCount, 1);
  assert.equal((await app.send({type: 'minimum-views-filter:get-history'}, pageSender)).history.xHighlightedCount, 1);
  enabled = true;
  assert.deepEqual(clone(await app.send({type, items: [highlightedEvent(3)]}, xSender)), {ok: true, recorded: 1});
  enabled = false;
  const reset = await app.send({type: 'minimum-views-filter:clear-history'}, pageSender);
  assert.equal(reset.history.xHighlightedCount, 0);
  assert.deepEqual(clone(reset.history.highlightedEntries), []);
  assert.equal(app.read().xHighlightedCount, 0);
});

test('kept events have their own counts and list and are validated separately', () => {
  let history = store.addEvents(null, [xEvent(1), keptEvent(2), keptEvent(3, {reason: 'high-bookmark-ratio', bypassedReason: 'low-like-ratio', bookmarks: 3}),
    keptEvent(11, {reason: 'high-like-and-bookmark-ratio', bookmarks: 3})], 'x', 1).history;
  assert.deepEqual(clone(history.xKeptCounts), {'high-like-and-bookmark-ratio': 1, 'high-like-ratio': 1, 'high-bookmark-ratio': 1});
  assert.deepEqual(totals(history), {x: 1, youtube: 0});
  assert.deepEqual(history.entries.map((entry) => entry.url), ['https://x.com/author/status/1']);
  assert.deepEqual(history.keptEntries.map((entry) => entry.url), ['https://x.com/author/status/11', 'https://x.com/author/status/3', 'https://x.com/author/status/2']);
  history.keptEntries.shift();
  assert.equal(history.keptEntries[1].bypassedReason, 'low-views');
  assert.equal(Object.hasOwn(history.keptEntries[1], 'outcome'), false);
  // Kept events cannot claim a hide reason, a missing bypass, YouTube, or no outcome.
  const rejected = store.addEvents(history, [
    keptEvent(4, {reason: 'low-views'}), keptEvent(5, {bypassedReason: 'unknown-views'}), keptEvent(6, {bypassedReason: undefined}),
    xEvent(7, {outcome: undefined}), xEvent(8, {outcome: 'shown'}), xEvent(9, {reason: 'high-like-ratio'}),
    // A combined keep needs both numerators.
    keptEvent(12, {reason: 'high-like-and-bookmark-ratio', bookmarks: null}),
    keptEvent(13, {reason: 'high-like-and-bookmark-ratio', likes: null, bookmarks: 3}),
  ], 'x', 2);
  assert.equal(rejected.recorded, 0);
  assert.equal(store.addEvents(null, [youtubeEvent('a', {outcome: 'kept', reason: 'high-like-ratio', bypassedReason: 'low-views'})], 'youtube', 1).recorded, 0);
  // Stored lists keep their own outcome; a kept entry in the hidden list is dropped.
  const normalized = store.normalizeHistory({entries: [{...history.keptEntries[0]}], keptEntries: history.keptEntries, xKeptCounts: {'high-like-ratio': 4, other: 2}});
  assert.equal(normalized.entries.length, 0);
  assert.equal(normalized.keptEntries.length, 2);
  assert.deepEqual(clone(normalized.xKeptCounts), {'high-like-and-bookmark-ratio': 0, 'high-like-ratio': 4, 'high-bookmark-ratio': 0});
  // Enrichment adds a kept entry without counting another kept event.
  const linkless = store.addEvents(null, [keptEvent(10, {url: null})], 'x', 1).history;
  const enriched = store.addEvents(linkless, [keptEvent(10, {enrich: true})], 'x', 2).history;
  assert.equal(store.siteTotal(enriched.xKeptCounts), 1);
  assert.equal(enriched.keptEntries.length, 1);
});

test('reset clears kept counts and entries', async () => {
  const app = openBackground();
  await app.send({type: 'minimum-views-filter:record-filtered', items: [keptEvent(1)]}, xSender);
  assert.equal(store.siteTotal(app.read().xKeptCounts), 1);
  const response = await app.send({type: 'minimum-views-filter:clear-history'}, pageSender);
  assert.equal(store.siteTotal(response.history.xKeptCounts), 0);
  assert.equal(app.read().keptEntries.length, 0);
});

test('history page shows kept totals and switches the list to kept posts', async () => {
  const dom = new JSDOM(source('history.html'), {url: pageSender.url, runScripts: 'outside-only'});
  let history = store.addEvents(null, [xEvent(1), keptEvent(2), keptEvent(3, {reason: 'high-bookmark-ratio', bypassedReason: 'low-like-ratio', likes: 0, bookmarks: 3})], 'x', 1).history;
  history = store.addEvents(history, [keptEvent(2)], 'x', 2).history;
  dom.window.chrome = {runtime: {sendMessage: async () => ({ok: true, history})}, storage: {sync: {get: async () => ({})}, onChanged: {addListener() {}}}};
  loadHistoryPageScripts(dom);
  await new Promise((resolve) => setImmediate(resolve));
  const document = dom.window.document;
  assert.equal(document.querySelector('#x-kept-count').textContent, '3');
  assert.equal(document.querySelector('#x-kept-reasons li[data-reason="high-bookmark-ratio"] .reason-count').textContent, '1');
  assert.equal(document.querySelector('#kept-entry-count').textContent, '2');
  assert.equal(document.querySelectorAll('#entries li').length, 1);
  document.querySelector('#site-filter [data-value="youtube"]').click();
  document.querySelector('#outcome-filter [data-value="kept"]').click();
  assert.equal(document.querySelector('#site-filter').hidden, true);
  assert.equal(document.querySelector('#reason-filter [data-value="low-views"]').hidden, true);
  assert.equal(document.querySelector('#reason-filter [data-value="high-like-ratio"]').hidden, false);
  assert.equal(document.querySelectorAll('#entries li').length, 2);
  const bookmarkRow = document.querySelector('#entries li[data-reason="high-bookmark-ratio"]');
  assert.match(bookmarkRow.querySelector('.entry-meta').textContent, /High bookmarks\/views · X · kept despite low likes\/views/);
  assert.match(document.querySelector('#entries li[data-reason="high-like-ratio"] .entry-meta').textContent, /kept 2 times/);
  document.querySelector('#reason-filter [data-value="high-like-ratio"]').click();
  assert.equal(document.querySelectorAll('#entries li').length, 1);
  document.querySelector('#outcome-filter [data-value="hidden"]').click();
  assert.equal(document.querySelector('#reason-filter [data-value="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#site-filter').hidden, false);
  dom.window.close();
});
