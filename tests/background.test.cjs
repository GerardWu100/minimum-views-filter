'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {SITE_PAGE_PATTERNS, oversizedSyncKeys} = require('../src/settings.js');

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
 * sendMessage is the tabs.sendMessage implementation under test. synced is
 * the live sync storage; syncGet may delay or fail its reads, and syncWrites
 * lists every sync write.
 */
function openBackground({style = 'chrome', sendMessage = async () => ({result: 'found', site: 'x', identifier: 'writer'}), openTabs = [], failingTabs = [],
  synced = {}, syncGet = async () => ({...synced})} = {}) {
  const calls = [];
  const syncWrites = [];
  const timers = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); };
  const api = {
    runtime: {id: 'extension-id', onInstalled: listenerSlot(), onStartup: listenerSlot(), onMessage: listenerSlot(), getURL: (name) => `chrome-extension://extension-id/${name}`, getManifest: () => ({action: {default_title: 'Minimum Views Filter'},
      content_scripts: [{js: ['settings.js', 'filter-core.js', 'content.js'], css: ['content.css']}]})},
    storage: {local: {get: async () => ({}), set: async () => {}}, sync: {
      get: syncGet,
      set: async (value) => { syncWrites.push(JSON.parse(JSON.stringify(value))); Object.assign(synced, value); },
    }},
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
  return {api, calls, timers, synced, syncWrites,
    click: (info, tab) => Promise.all(api.contextMenus.onClicked.listeners.map((listener) => listener(info, tab))),
    /** Deliver a runtime message and resolve with its sendResponse value, serialized like a browser's. */
    message: (message, sender) => new Promise((resolve) => {
      const respond = (response) => resolve(JSON.parse(JSON.stringify(response)));
      if (api.runtime.onMessage.listeners[0](message, sender, respond) !== true) resolve(undefined);
    })};
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
  const {calls, timers, click, synced} = openBackground();
  await click({menuItemId: 'always-show-creator', frameId: 3}, {id: 7});
  assert.deepEqual(JSON.parse(JSON.stringify(synced.xWhitelist)), ['writer']);
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

const MENU_CLICK = {menuItemId: 'always-show-creator'};
const badgeTitle = (calls) => calls.filter(([name]) => name === 'setTitle').at(-1)[1].title;

test('menu click reports present, switched-off, full, failed, and unusable answers', async () => {
  const present = openBackground({synced: {xWhitelist: ['writer']}});
  await present.click(MENU_CLICK, {id: 1});
  assert.equal(badgeTitle(present.calls), 'Already in whitelist');
  assert.equal(present.syncWrites.length, 0);

  const switchedOff = openBackground({synced: {xWhitelistEnabled: false}});
  await switchedOff.click(MENU_CLICK, {id: 1});
  assert.equal(badgeTitle(switchedOff.calls), 'In whitelist, but the whitelist is switched off in Settings');
  assert.deepEqual(switchedOff.syncWrites, [{xWhitelist: ['writer']}]);

  const handles = [];
  // Fill to the largest list that fits one sync item; fillers match 'writer' in length.
  const filler = () => 'w' + String(handles.length).padStart(5, '0');
  while (!oversizedSyncKeys({xWhitelist: [...handles, filler()]}).length) handles.push(filler());
  const full = openBackground({synced: {xWhitelist: handles}});
  await full.click(MENU_CLICK, {id: 1});
  assert.equal(badgeTitle(full.calls), 'Whitelist is too long to sync');
  assert.equal(full.syncWrites.length, 0);

  const failed = openBackground({syncGet: async () => { throw new Error('Unavailable'); }});
  await failed.click(MENU_CLICK, {id: 1});
  assert.equal(badgeTitle(failed.calls), 'Could not update whitelist');

  for (const response of [{result: 'missing'}, {result: 'found', site: 'other', identifier: 'writer'}, {result: 'found', site: 'x', identifier: 'Display Name'}, undefined]) {
    const unusable = openBackground({sendMessage: async () => response});
    await unusable.click(MENU_CLICK, {id: 1});
    assert.equal(badgeTitle(unusable.calls), response?.site === 'x' ? 'Could not update whitelist' : 'No creator found where you right-clicked', JSON.stringify(response));
    assert.equal(unusable.syncWrites.length, 0);
  }
});

for (const style of ['chrome', 'firefox']) {
  test(`${style}: concurrent whitelist additions from two tabs both survive`, async () => {
    // Every read waits a macrotask, so unserialized writers would both read ['nasa'].
    const synced = {xWhitelist: ['nasa']};
    const identifiers = {1: 'spacex', 2: 'openai'};
    const background = openBackground({style, synced,
      syncGet: () => new Promise((resolve) => setImmediate(() => resolve({...synced}))),
      sendMessage: async (tabId) => ({result: 'found', site: 'x', identifier: identifiers[tabId]})});
    await Promise.all([background.click(MENU_CLICK, {id: 1}), background.click(MENU_CLICK, {id: 2})]);
    assert.deepEqual(JSON.parse(JSON.stringify(synced.xWhitelist)), ['nasa', 'spacex', 'openai']);
    assert.deepEqual(background.calls.filter(([name]) => name === 'setTitle').map(([, {title}]) => title), ['Added to whitelist', 'Added to whitelist']);
  });

  test(`${style}: Settings patches apply in order, keep removals, and accept only the Settings page`, async () => {
    const synced = {xWhitelist: ['nasa', 'old'], youtubeMinimumViews: 1000};
    const background = openBackground({style, synced,
      syncGet: () => new Promise((resolve) => setImmediate(() => resolve({...synced}))),
      sendMessage: async () => ({result: 'found', site: 'x', identifier: 'spacex'})});
    const settingsPage = {id: 'extension-id', url: 'chrome-extension://extension-id/options.html'};
    const patch = {type: 'minimum-views-filter:update-settings', values: {youtubeMinimumViews: 5000}, whitelists: {x: {add: ['@NASA'], remove: ['old']}}};
    const [saved] = await Promise.all([background.message(patch, settingsPage), background.click(MENU_CLICK, {id: 1})]);
    assert.deepEqual(saved, {ok: true});
    // The removal stays removed and the concurrent menu addition survives.
    assert.deepEqual(JSON.parse(JSON.stringify(synced)), {xWhitelist: ['nasa', 'spacex'], youtubeMinimumViews: 5000});
    const writesBefore = background.syncWrites.length;
    for (const sender of [{id: 'extension-id', url: 'https://x.com/home', tab: {id: 1}}, {id: 'other-extension', url: settingsPage.url}, {id: 'extension-id', url: 'chrome-extension://extension-id/history.html'}]) {
      assert.deepEqual(await background.message(patch, sender), {ok: false, error: 'forbidden'});
    }
    for (const invalid of [{values: {xMinimumViews: -1}}, {values: {unknownKey: true}}, {values: {xWhitelist: []}}, {whitelists: {x: {add: ['Display Name']}}}, {whitelists: {other: {add: []}}}]) {
      assert.deepEqual(await background.message({type: patch.type, ...invalid}, settingsPage), {ok: false, error: 'invalid'}, JSON.stringify(invalid));
    }
    assert.equal(background.syncWrites.length, writesBefore);
  });
}
