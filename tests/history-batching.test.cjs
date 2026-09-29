'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const store = require('../src/history-store.js');

const RECORD = 'minimum-views-filter:record-filtered';
const READ = 'minimum-views-filter:get-history';
const RESET = 'minimum-views-filter:clear-history';
const FIXED_TIME = 1_000_000;
const SOURCE_DIRECTORY = path.join(__dirname, '..', 'src');
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const xSender = {id: 'test-extension', tab: {id: 1}, frameId: 0, url: 'https://x.com/home'};
const youtubeSender = {id: 'test-extension', tab: {id: 2}, frameId: 0, url: 'https://www.youtube.com/'};
const historySender = {id: 'test-extension', url: 'chrome-extension://test-extension/history.html'};
const event = (site, id, extra = {}) => ({
  site, outcome: 'hidden', title: `Item ${id}`, reason: 'low-views', views: 999,
  likes: null, bookmarks: null, replies: null,
  url: site === 'x' ? `https://x.com/author/status/${id}` : `https://www.youtube.com/watch?v=${id}`,
  ...extra,
});

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {resolve = accept;});
  return {promise, resolve};
}

/** Run the actual background listener against asynchronous, observable storage. */
function openBackground({style = 'chrome', syncGet, localGet, localSet} = {}) {
  let listener;
  let history;
  const calls = {syncGet: 0, localGet: 0, localSet: 0};
  const writes = [];
  const api = {
    runtime: {
      id: 'test-extension', getURL: (name) => `chrome-extension://test-extension/${name}`,
      onMessage: {addListener: (callback) => {listener = callback;}},
      onInstalled: {addListener() {}}, onStartup: {addListener() {}},
    },
    contextMenus: {onClicked: {addListener() {}}},
    storage: {
      sync: {get: async () => {
        calls.syncGet++;
        return syncGet ? syncGet(calls.syncGet) : {statisticsEnabled: true};
      }},
      local: {
        get: async () => {
          calls.localGet++;
          if (localGet) await localGet(calls.localGet);
          return {filterHistory: clone(history)};
        },
        set: async (update) => {
          calls.localSet++;
          if (localSet) await localSet(calls.localSet);
          history = clone(update.filterHistory);
          writes.push(clone(history));
        },
      },
    },
  };
  class FixedDate extends Date {static now() {return FIXED_TIME;}}
  const context = vm.createContext({URL, Date: FixedDate, setTimeout, clearTimeout});
  context[style === 'chrome' ? 'chrome' : 'browser'] = api;
  const load = (name) => vm.runInContext(readFileSync(path.join(SOURCE_DIRECTORY, name), 'utf8'), context);
  if (style === 'chrome') context.importScripts = load;
  else {load('settings.js'); load('history-store.js');}
  load('background.js');
  return {
    calls, writes, read: () => clone(history),
    send: (message, sender = historySender) => new Promise((resolve) => {
      assert.equal(listener(message, sender, (response) => resolve(clone(response))), true);
    }),
    record(items, sender = xSender) {return this.send({type: RECORD, items}, sender);},
  };
}

for (const style of ['chrome', 'firefox']) {
  test(`${style}: four immediate messages share a write and match sequential history`, async () => {
    const app = openBackground({style});
    const items = [1, 2, 3, 4].map((id) => event('youtube', id));
    const results = await Promise.all(items.map((item) => app.record([item], youtubeSender)));
    assert.deepEqual(results, items.map(() => ({ok: true, recorded: 1})));
    assert.deepEqual(app.calls, {syncGet: 4, localGet: 1, localSet: 1});
    let expected;
    for (const item of items) expected = store.addEvents(expected, [item], 'youtube', FIXED_TIME).history;
    assert.deepEqual(app.read(), clone(expected));
  });

  test(`${style}: reads and reset separate adjacent batches in arrival order`, async () => {
    const app = openBackground({style});
    const requests = [
      app.record([event('x', 1)]), app.record([event('x', 2)]), app.send({type: READ}),
      app.record([event('x', 3)]), app.send({type: RESET}),
      app.record([event('youtube', 4)], youtubeSender), app.send({type: READ}),
    ];
    const results = await Promise.all(requests);
    assert.equal(store.siteTotal(results[2].history.counts.x), 2);
    assert.equal(store.siteTotal(results[4].history.counts.x), 0);
    assert.equal(store.siteTotal(results[6].history.counts.x), 0);
    assert.equal(store.siteTotal(results[6].history.counts.youtube), 1);
    assert.deepEqual(app.writes.map((history) => store.siteTotal(history.counts.x)), [2, 3, 0, 0]);
    assert.deepEqual(app.calls, {syncGet: 4, localGet: 5, localSet: 4});
  });
}

test('multiple tabs/sites and outcomes retain exact event order and per-message counts', async () => {
  const app = openBackground();
  const messages = [
    {site: 'x', items: [event('x', 1), event('x', 2, {url: null})]},
    {site: 'youtube', items: [event('youtube', 3)]},
    {site: 'x', items: [event('x', 2, {enrich: true}), event('x', 1, {title: 'New title'})]},
    {site: 'x', items: [event('x', 4, {outcome: 'kept', reason: 'high-engagement', bypassedReason: 'low-views', likes: 30})]},
    {site: 'x', items: [event('x', 4, {outcome: 'highlighted', reason: 'high-bookmark-ratio', bookmarks: 30})]},
  ];
  const results = await Promise.all(messages.map(({site, items}, index) => app.record(items,
    {...(site === 'x' ? xSender : youtubeSender), tab: {id: index + 1}})));
  assert.deepEqual(results.map((result) => result.recorded), [2, 1, 2, 1, 1]);
  let expected;
  for (const {site, items} of messages) expected = store.addEvents(expected, items, site, FIXED_TIME).history;
  assert.deepEqual(app.read(), clone(expected));
  assert.equal(app.calls.localSet, 1);
});

test('messages joining during settings reads batch without waiting on a collection timer', async () => {
  const started = deferred();
  const release = deferred();
  const app = openBackground({syncGet: async (index) => {
    if (index === 1) {started.resolve(); await release.promise;}
    return {statisticsEnabled: true};
  }});
  const first = app.record([event('x', 1)]);
  await started.promise;
  const next = app.record([event('youtube', 2)], youtubeSender);
  release.resolve();
  assert.deepEqual(await Promise.all([first, next]), [{ok: true, recorded: 1}, {ok: true, recorded: 1}]);
  assert.equal(app.calls.localSet, 1);
});

test('success responses wait until the batched local write succeeds', async () => {
  const started = deferred();
  const release = deferred();
  let responses = 0;
  const app = openBackground({localSet: async () => {started.resolve(); await release.promise;}});
  const requests = [1, 2].map((id) => app.record([event('x', id)]).then((response) => {responses++; return response;}));
  await started.promise;
  assert.equal(responses, 0);
  release.resolve();
  await Promise.all(requests);
  assert.equal(responses, 2);
});

test('every message sees fresh collection settings, including pauses during a batch', async () => {
  let enabled = true;
  const started = deferred();
  const release = deferred();
  const app = openBackground({syncGet: async (index) => {
    const statisticsEnabled = enabled;
    if (index === 1) {started.resolve(); await release.promise;}
    return {statisticsEnabled};
  }});
  const first = app.record([event('x', 1)]);
  const second = app.record([event('x', 2)]);
  await started.promise;
  enabled = false;
  release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [{ok: true, recorded: 1}, {ok: true, recorded: 0}]);
  assert.equal(store.siteTotal(app.read().counts.x), 1);
  enabled = true;
  assert.deepEqual(await app.record([event('x', 3)]), {ok: true, recorded: 1});
  enabled = false;
  assert.deepEqual(await app.record([event('x', 4, {reason: 'invented'})]), {ok: true, recorded: 0});
  assert.equal(store.siteTotal((await app.send({type: READ})).history.counts.x), 2);
  assert.equal(store.siteTotal((await app.send({type: RESET})).history.counts.x), 0);
});

test('untrusted routes, oversized messages, and malformed events cannot enter stored batches', async () => {
  const app = openBackground();
  const forbidden = await app.record([event('x', 1)], {...xSender, url: 'https://x.com/search'});
  const oversized = await app.record(Array(101).fill(event('x', 1)));
  const wrongSite = app.record([event('youtube', 1)]);
  const mixed = app.record([event('x', 2, {title: 'x'.repeat(10_000)}), event('x', 3), event('x', 4, {url: 'https://evil.example/'})]);
  assert.deepEqual(forbidden, {ok: false, error: 'forbidden'});
  assert.deepEqual(oversized, {ok: false, error: 'invalid-message'});
  assert.deepEqual(await wrongSite, {ok: false, error: 'invalid-message'});
  assert.deepEqual(await mixed, {ok: true, recorded: 1});
  assert.equal(store.siteTotal(app.read().counts.x), 1);
  assert.equal(app.read().entries[0].url, event('x', 3).url);
  assert.equal(app.calls.localSet, 1);
});

test('queued requests retain sanitized snapshots rather than raw event or sender objects', async () => {
  const started = deferred();
  const release = deferred();
  const app = openBackground({syncGet: async () => {started.resolve(); await release.promise; return {};}});
  const item = event('x', 1, {irrelevant: {large: 'x'.repeat(100_000)}});
  const sender = {...xSender};
  const request = app.record([item], sender);
  await started.promise;
  item.title = 'Changed after dispatch';
  item.url = 'https://evil.example/';
  sender.url = 'https://youtube.com/';
  release.resolve();
  assert.deepEqual(await request, {ok: true, recorded: 1});
  assert.equal(app.read().entries[0].title, 'Item 1');
  assert.equal(Object.hasOwn(app.read().entries[0], 'irrelevant'), false);
});

test('bounded transactions split larger bursts without losing normal-load events', async () => {
  const app = openBackground();
  const numberOfMessages = store.MAX_EVENT_BATCHES * 2 + 1;
  const results = await Promise.all(Array.from({length: numberOfMessages}, (_, index) => app.record([event('x', index + 1)])));
  assert.ok(results.every((response) => response.ok && response.recorded === 1));
  assert.equal(store.siteTotal(app.read().counts.x), numberOfMessages);
  assert.equal(app.calls.localSet, 3);
});

for (const failure of ['localGet', 'localSet']) {
  test(`${failure} failure rejects the affected batch and later writes recover without phantom events`, async () => {
    let failing = true;
    const app = openBackground({[failure]: async () => {if (failing) throw new Error('storage failed');}});
    const results = await Promise.all([app.record([event('x', 1)]), app.record([event('x', 2)])]);
    assert.deepEqual(results, [{ok: false, error: 'storage-unavailable'}, {ok: false, error: 'storage-unavailable'}]);
    assert.equal(app.read(), undefined);
    failing = false;
    assert.deepEqual(await app.record([event('x', 3)]), {ok: true, recorded: 1});
    assert.equal(store.siteTotal(app.read().counts.x), 1);
    assert.equal(app.read().entries[0].url, event('x', 3).url);
  });
}

test('one failed settings read does not discard other records in the batch', async () => {
  const app = openBackground({syncGet: async (index) => {if (index === 2) throw new Error('unavailable'); return {};}});
  const results = await Promise.all([1, 2, 3].map((id) => app.record([event('x', id)])));
  assert.deepEqual(results, [{ok: true, recorded: 1}, {ok: false, error: 'storage-unavailable'}, {ok: true, recorded: 1}]);
  assert.equal(store.siteTotal(app.read().counts.x), 2);
  assert.equal(app.calls.localSet, 1);
});

for (const failure of [false, true]) {
  test(`the 2,048-item queue cap includes active records and releases capacity after ${failure ? 'failure' : 'success'}`, async () => {
    const started = deferred();
    const release = deferred();
    let failWrite = failure;
    const app = openBackground({
      syncGet: async (index) => {if (index === 1) {started.resolve(); await release.promise;} return {};},
      localSet: async () => {if (failWrite) throw new Error('unavailable');},
    });
    const requests = [app.record(Array.from({length: 100}, (_, index) => event('x', index + 1)))];
    await started.promise;
    for (let batch = 1; batch < 20; batch++) {
      requests.push(app.record(Array.from({length: 100}, (_, index) => event('x', batch * 100 + index + 1))));
    }
    requests.push(app.record(Array.from({length: 48}, (_, index) => event('x', 2001 + index))));
    assert.deepEqual(await app.record([event('x', 3000)]), {ok: false, error: 'history-busy'});
    release.resolve();
    const results = await Promise.all(requests);
    if (failure) assert.ok(results.every((response) => response.error === 'storage-unavailable'));
    else assert.equal(store.siteTotal(app.read().counts.x), 2048);
    failWrite = false;
    assert.deepEqual(await app.record(Array.from({length: 100}, (_, index) => event('x', 4000 + index))), {ok: true, recorded: 100});
  });
}

test('the 256-request cap also bounds zero-item requests and recovers after a failed reset', async () => {
  const started = deferred();
  const release = deferred();
  const app = openBackground({localGet: async (index) => {if (index === 1) {started.resolve(); await release.promise;}},
    localSet: async (index) => {if (index === 1) throw new Error('reset failed');}});
  const requests = [app.send({type: READ})];
  await started.promise;
  requests.push(app.send({type: RESET}));
  for (let index = 2; index < 256; index++) requests.push(app.send({type: READ}));
  assert.deepEqual(await app.send({type: READ}), {ok: false, error: 'history-busy'});
  release.resolve();
  const responses = await Promise.all(requests);
  assert.deepEqual(responses[1], {ok: false, error: 'storage-unavailable'});
  assert.ok(responses.every((response, index) => index === 1 || response.ok));
  assert.equal((await app.send({type: RESET})).ok, true);
  assert.deepEqual(await app.record([event('x', 1)]), {ok: true, recorded: 1});
});
