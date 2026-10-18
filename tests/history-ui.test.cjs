'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const store = require('../src/history-store.js');

const source = (filename) => readFileSync(path.join(__dirname, '..', 'src', filename), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openHistory(t, visibility = 'visible') {
  const dom = new JSDOM(source('history.html'), {url: 'https://extension.invalid/history.html', runScripts: 'outside-only'});
  const document = dom.window.document;
  const messages = [];
  let changed;
  let renderCount = 0;
  Object.defineProperty(document, 'visibilityState', {get: () => visibility});
  const entries = document.querySelector('#entries');
  const replaceChildren = entries.replaceChildren.bind(entries);
  entries.replaceChildren = (...children) => {
    renderCount++;
    replaceChildren(...children);
  };
  dom.window.chrome = {
    runtime: {sendMessage: (message) => new Promise((resolve) => messages.push({message, resolve}))},
    storage: {sync: {get: async () => ({})}, onChanged: {addListener: (listener) => {changed = listener;}}},
  };
  for (const name of ['history-store.js', 'reason-breakdown.js', 'history.js']) dom.window.eval(source(name));
  t.after(() => dom.window.close());
  return {
    document, messages,
    get renderCount() {return renderCount;},
    changed: () => changed({filterHistory: {newValue: {}}}, 'local'),
    setCollectionEnabled: (enabled) => changed({statisticsEnabled: {newValue: enabled}}, 'sync'),
    setVisibility: (value) => {
      visibility = value;
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    },
  };
}

function fullHistory() {
  const history = store.emptyHistory();
  history.counts.x['low-views'] = store.MAX_ENTRIES;
  history.entries = Array.from({length: store.MAX_ENTRIES}, (_, index) => ({
    site: 'x', url: `https://x.com/author/status/${index + 1}`, title: `Post ${index + 1}`,
    reason: 'low-views', views: 10, likes: null, bookmarks: null,
    lastFilteredAt: 1, events: 1,
  }));
  return history;
}

test('hidden history pages do no reads or row rebuilds until visible, then refresh once', async (t) => {
  const page = openHistory(t, 'hidden');
  for (let index = 0; index < 20; index++) page.changed();
  await tick();
  assert.equal(page.messages.length, 0);
  assert.equal(page.renderCount, 0);

  page.setVisibility('visible');
  assert.equal(page.messages.length, 1);
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, store.MAX_ENTRIES);
  assert.equal(page.renderCount, 1);
});

test('twenty changes during a pending history read coalesce into one fresh read and render', async (t) => {
  const page = openHistory(t);
  for (let index = 0; index < 20; index++) page.changed();
  assert.equal(page.messages.length, 1);
  page.messages[0].resolve({ok: true, history: store.emptyHistory()});
  await tick();
  assert.equal(page.messages.length, 2);
  assert.equal(page.renderCount, 0, 'the superseded snapshot must not replace the page');
  page.messages[1].resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, store.MAX_ENTRIES);
  assert.equal(page.renderCount, 1);
});

test('a history read finishing after a successful reset cannot restore old rows or re-enable reset', async (t) => {
  const page = openHistory(t);
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  page.changed();
  const staleRead = page.messages[1];
  page.document.querySelector('#clear-history').click();
  page.document.querySelector('#confirm-reset').click();
  assert.equal(page.messages[2].message.type, 'minimum-views-filter:clear-history');
  page.messages[2].resolve({ok: true, history: store.emptyHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, 0);

  staleRead.resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, 0);
  assert.equal(page.document.querySelector('#clear-history').disabled, true);
  assert.equal(page.messages.length, 3);
});

test('a failed reset reloads history after invalidating an in-flight refresh', async (t) => {
  const page = openHistory(t);
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, store.MAX_ENTRIES);

  page.changed();
  const staleRead = page.messages[1];
  page.document.querySelector('#clear-history').click();
  page.document.querySelector('#confirm-reset').click();
  page.messages[2].resolve({ok: false});
  await tick();

  assert.match(page.document.querySelector('#status').textContent, /Could not reset/);
  staleRead.resolve({ok: true, history: store.emptyHistory()});
  await tick();
  assert.equal(page.messages.length, 4, 'a fresh history read should follow the failed reset');
  assert.equal(page.messages[3].message.type, 'minimum-views-filter:get-history');
  page.messages[3].resolve({ok: true, history: fullHistory()});
  await tick();

  assert.equal(page.document.querySelectorAll('#entries li').length, store.MAX_ENTRIES);
  assert.equal(page.document.querySelector('#clear-history').disabled, false);
});

test('a read finishing in a hidden history tab defers its row rebuild until return', async (t) => {
  const page = openHistory(t);
  page.setVisibility('hidden');
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.renderCount, 0);
  page.setVisibility('visible');
  assert.equal(page.messages.length, 2);
  page.messages[1].resolve({ok: true, history: fullHistory()});
  await tick();
  assert.equal(page.renderCount, 1);
});

test('statistics shows highlighted totals, separate entries, settings link, and paused state', async (t) => {
  const page = openHistory(t);
  const history = store.emptyHistory();
  history.xHighlightedCount = 3;
  history.highlightedEntries = [{
    site: 'x', url: 'https://x.com/author/status/7', title: 'Highlighted post',
    reason: 'high-bookmark-ratio', views: 1000, likes: 20, bookmarks: 15,
    lastFilteredAt: 1, events: 2,
  }];
  page.messages[0].resolve({ok: true, history});
  await tick();
  assert.equal(page.document.title, 'Statistics · Minimum Views Filter');
  assert.equal(page.document.querySelector('a.settings-link').getAttribute('href'), 'options.html');
  assert.equal(page.document.querySelector('#x-highlighted-count').textContent, '3');
  assert.equal(page.document.querySelector('#highlighted-entry-count').textContent, '1');
  assert.equal(page.document.querySelector('#clear-history').disabled, false);
  page.document.querySelector('#outcome-filter [data-value="highlighted"]').click();
  assert.equal(page.document.querySelector('#site-filter').hidden, true);
  assert.equal(page.document.querySelectorAll('#entries li').length, 1);
  assert.match(page.document.querySelector('#entries li .entry-meta').textContent, /highlighted 2 times/);
  assert.match(page.document.querySelector('#entries li .entry-metrics').textContent, /Bookmarks\/views 1.5%/);
  page.setCollectionEnabled(false);
  assert.equal(page.document.querySelector('#collection-status').hidden, false);
  page.setCollectionEnabled(true);
  assert.equal(page.document.querySelector('#collection-status').hidden, true);
});

test('rows show the author, and Export CSV saves every list with formula-safe cells', async (t) => {
  const page = openHistory(t);
  const history = store.emptyHistory();
  history.counts.x['low-views'] = 1;
  history.xKeptCounts['high-engagement'] = 1;
  history.entries = [{site: 'youtube', url: 'https://www.youtube.com/watch?v=a', title: '=HYPERLINK("x")', author: 'Channel, Inc',
    reason: 'low-views', views: 10, likes: null, bookmarks: null, replies: null, lastFilteredAt: Date.UTC(2026, 9, 17), events: 1}];
  history.keptEntries = [{site: 'x', url: 'https://x.com/nasa/status/1', title: 'Kept post', author: '@NASA', reason: 'high-engagement',
    bypassedReason: 'low-views', views: 500, likes: 10, bookmarks: 3, replies: 1, lastFilteredAt: 0, events: 2}];
  page.messages[0].resolve({ok: true, history});
  await tick();
  const meta = page.document.querySelector('#entries li .entry-meta');
  assert.equal(meta.querySelector('.entry-author').textContent, 'Channel, Inc');
  assert.match(meta.textContent, /^Low views · YouTube · Channel, Inc · /);

  const window = page.document.defaultView;
  const saved = [];
  window.URL.createObjectURL = (blob) => {
    saved.push(blob);
    return 'blob:export';
  };
  window.URL.revokeObjectURL = () => {};
  let downloadName = null;
  window.HTMLAnchorElement.prototype.click = function () {downloadName = this.download;};
  const exportButton = page.document.querySelector('#export-csv');
  assert.equal(exportButton.disabled, false);
  exportButton.click();
  assert.match(downloadName, /^minimum-views-statistics-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await saved[0].text()).replace(/^\ufeff/, '');
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'outcome,site,author,title,url,reason,kept_despite,views,likes,bookmarks,replies,events,last_seen_utc');
  assert.equal(lines[1], `hidden,youtube,"Channel, Inc","'=HYPERLINK(""x"")",https://www.youtube.com/watch?v=a,low-views,,10,,,,1,2026-10-17T00:00:00.000Z`);
  assert.equal(lines[2], 'kept,x,@NASA,Kept post,https://x.com/nasa/status/1,high-engagement,low-views,500,10,3,1,2,');
  assert.equal(lines.length, 3);
});

test('Reset statistics asks for confirmation; Cancel and Escape keep history', async (t) => {
  const page = openHistory(t);
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  const button = (id) => page.document.querySelector(id);
  button('#clear-history').click();
  assert.equal(page.messages.length, 1, 'the first click only asks');
  assert.equal(button('#clear-history').hidden, true);
  assert.equal(button('#confirm-reset').hidden, false);
  assert.equal(page.document.activeElement, button('#cancel-reset'));
  button('#cancel-reset').click();
  assert.equal(button('#clear-history').hidden, false);
  assert.equal(button('#confirm-reset').hidden, true);
  assert.equal(button('#cancel-reset').hidden, true);

  button('#clear-history').click();
  page.document.dispatchEvent(new page.document.defaultView.KeyboardEvent('keydown', {key: 'Escape'}));
  assert.equal(button('#confirm-reset').hidden, true);
  assert.equal(page.messages.length, 1);
  assert.equal(page.document.querySelectorAll('#entries li').length, store.MAX_ENTRIES);

  button('#clear-history').click();
  button('#confirm-reset').click();
  assert.equal(page.messages[1].message.type, 'minimum-views-filter:clear-history');
  assert.equal(button('#clear-history').hidden, false);
  page.messages[1].resolve({ok: true, history: store.emptyHistory()});
  await tick();
  assert.equal(page.document.querySelectorAll('#entries li').length, 0);
});
