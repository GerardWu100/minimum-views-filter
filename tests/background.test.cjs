'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {SITE_PAGE_PATTERNS} = require('../src/settings.js');

const source = (name) => readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const listenerSlot = () => {
  const listeners = [];
  return {listeners, addListener: (listener) => listeners.push(listener)};
};

/**
 * Run background.js against a recorded extension API.
 *
 * style 'chrome' runs it alone like a service worker (importScripts loads
 * settings.js); 'firefox' loads settings.js first like manifest background scripts.
 * sendMessage is the tabs.sendMessage implementation under test.
 */
function openBackground({style = 'chrome', sendMessage = async () => ({result: 'added'}), openTabs = [], failingTabs = []} = {}) {
  const calls = [];
  const timers = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); };
  const api = {
    runtime: {id: 'extension-id', onInstalled: listenerSlot(), onStartup: listenerSlot(), onMessage: listenerSlot(), getURL: (name) => `chrome-extension://extension-id/${name}`, getManifest: () => ({action: {default_title: 'Minimum Views Filter'},
      content_scripts: [{js: ['settings.js', 'filter-core.js', 'content.js'], css: ['content.css']}]})},
    storage: {local: {get: async () => ({}), set: async () => {}}, sync: {get: async () => ({})}},
    contextMenus: {removeAll: record('removeAll'), create: (...args) => calls.push(['create', ...args]), onClicked: listenerSlot()},
    tabs: {
      sendMessage: (...args) => { calls.push(['sendMessage', ...args]); return sendMessage(...args); },
      query: async (filter) => { calls.push(['query', filter]); return openTabs; },
    },
    scripting: {
      insertCSS: async (options) => { calls.push(['insertCSS', options]); },
      executeScript: async (options) => {
        calls.push(['executeScript', options]);
        if (failingTabs.includes(options.target.tabId)) throw new Error('Cannot access contents of the page');
      },
    },
    action: {setBadgeText: record('setBadgeText'), setTitle: record('setTitle')},
  };
  // Timer IDs are 1-based indexes into timers; cleared timers stay listed.
  const context = vm.createContext({
    setTimeout: (callback, delay) => timers.push({callback, delay, cleared: false}),
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    TextEncoder,
    URL,
  });
  context.globalThis = context;
  context[style === 'firefox' ? 'browser' : 'chrome'] = api;
  if (style === 'chrome') context.importScripts = (name) => vm.runInContext(source(name), context);
  else {
    vm.runInContext(source('settings.js'), context);
    vm.runInContext(source('history-store.js'), context);
  }
  vm.runInContext(source('background.js'), context);
  return {api, calls, timers, click: (info, tab) => Promise.all(api.contextMenus.onClicked.listeners.map((listener) => listener(info, tab)))};
}

for (const style of ['chrome', 'firefox']) {
  test(`${style}: install and startup recreate one menu limited to X and YouTube pages`, async () => {
    const {api, calls} = openBackground({style});
    await api.runtime.onInstalled.listeners[0]({reason: 'chrome_update'});
    await api.runtime.onStartup.listeners[0]();
    const created = calls.filter(([name]) => name === 'create').map(([, options]) => JSON.parse(JSON.stringify(options)));
    assert.deepEqual(calls.map(([name]) => name), ['removeAll', 'create', 'removeAll', 'create']);
    assert.deepEqual(created[0], {id: 'always-show-creator', title: 'Always show this creator', contexts: ['all'], documentUrlPatterns: [...SITE_PAGE_PATTERNS]});
  });
}

for (const reason of ['install', 'update']) {
  test(`${reason}: open X/YouTube tabs get the current page script, skipping discarded and refusing tabs`, async () => {
    const {api, calls} = openBackground({openTabs: [{id: 4}, {id: 5, discarded: true}, {id: 6}], failingTabs: [4]});
    await api.runtime.onInstalled.listeners[0]({reason});
    await new Promise((resolve) => setImmediate(resolve));
    const plain = JSON.parse(JSON.stringify(calls.filter(([name]) => ['query', 'insertCSS', 'executeScript'].includes(name))));
    assert.deepEqual(plain[0], ['query', {url: [...SITE_PAGE_PATTERNS]}]);
    assert.deepEqual(plain.slice(1).map(([name, {target}]) => [name, target.tabId]).sort(),
      [['executeScript', 4], ['executeScript', 6], ['insertCSS', 4], ['insertCSS', 6]]);
    assert.deepEqual(plain.find(([name]) => name === 'executeScript')[1].files, ['settings.js', 'filter-core.js', 'content.js']);
    assert.deepEqual(plain.find(([name]) => name === 'insertCSS')[1].files, ['content.css']);
  });
}

test('menu click asks the clicked frame, shows the result, then restores the icon', async () => {
  const {calls, timers, click} = openBackground({sendMessage: async () => ({result: 'added', identifier: 'writer'})});
  await click({menuItemId: 'always-show-creator', frameId: 3}, {id: 7});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['sendMessage', 7, {type: 'minimum-views-filter:whitelist-creator'}, {frameId: 3}],
    ['setBadgeText', {tabId: 7, text: '✓'}],
    ['setTitle', {tabId: 7, title: 'Added to whitelist'}],
  ]);
  assert.equal(timers.length, 1);
  timers[0].callback();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(3))), [
    ['setBadgeText', {tabId: 7, text: ''}],
    ['setTitle', {tabId: 7, title: 'Minimum Views Filter'}],
  ]);
});

test('a second click on the same tab keeps its badge for the full duration', async () => {
  const {timers, click} = openBackground();
  await click({menuItemId: 'always-show-creator'}, {id: 7});
  await click({menuItemId: 'always-show-creator'}, {id: 7});
  await click({menuItemId: 'always-show-creator'}, {id: 8});
  assert.deepEqual(timers.map(({cleared}) => cleared), [true, false, false]);
});

test('menu click reports tabs without a content script and ignores other menus', async () => {
  const {calls, click} = openBackground({sendMessage: async () => { throw new Error('Receiving end does not exist'); }});
  await click({menuItemId: 'other'}, {id: 7});
  await click({menuItemId: 'always-show-creator'}, undefined);
  assert.equal(calls.length, 0);
  await click({menuItemId: 'always-show-creator'}, {id: 9});
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(1))), [
    ['setBadgeText', {tabId: 9, text: '?'}],
    ['setTitle', {tabId: 9, title: 'No creator found where you right-clicked'}],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][3])), {frameId: 0});
});
