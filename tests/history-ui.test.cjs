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
    storage: {onChanged: {addListener: (listener) => {changed = listener;}}},
  };
  for (const name of ['history-store.js', 'reason-breakdown.js', 'history.js']) dom.window.eval(source(name));
  t.after(() => dom.window.close());
  return {
    document, messages,
    get renderCount() {return renderCount;},
    changed: () => changed({filterHistory: {newValue: {}}}, 'local'),
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
  assert.equal(page.document.querySelectorAll('#entries li').length, 500);
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
  assert.equal(page.document.querySelectorAll('#entries li').length, 500);
  assert.equal(page.renderCount, 1);
});

test('a history read finishing after a successful reset cannot restore old rows or re-enable reset', async (t) => {
  const page = openHistory(t);
  page.messages[0].resolve({ok: true, history: fullHistory()});
  await tick();
  page.changed();
  const staleRead = page.messages[1];
  page.document.querySelector('#clear-history').click();
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
