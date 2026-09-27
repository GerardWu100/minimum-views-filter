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
function openBackground({style = 'chrome', sendMessage = async () => ({result: 'added'})} = {}) {
  const calls = [];
  const timers = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); };
  const api = {
    runtime: {onInstalled: listenerSlot(), onStartup: listenerSlot(), getManifest: () => ({action: {default_title: 'Minimum Views Filter'}})},
    contextMenus: {removeAll: record('removeAll'), create: (...args) => calls.push(['create', ...args]), onClicked: listenerSlot()},
    tabs: {sendMessage: (...args) => { calls.push(['sendMessage', ...args]); return sendMessage(...args); }},
    action: {setBadgeText: record('setBadgeText'), setTitle: record('setTitle')},
  };
  const context = vm.createContext({setTimeout: (callback, delay) => timers.push({callback, delay}), TextEncoder});
  context.globalThis = context;
  context[style === 'firefox' ? 'browser' : 'chrome'] = api;
  if (style === 'chrome') context.importScripts = (name) => vm.runInContext(source(name), context);
  else vm.runInContext(source('settings.js'), context);
  vm.runInContext(source('background.js'), context);
  return {api, calls, timers, click: (info, tab) => Promise.all(api.contextMenus.onClicked.listeners.map((listener) => listener(info, tab)))};
}

for (const style of ['chrome', 'firefox']) {
  test(`${style}: install and startup recreate one menu limited to X and YouTube pages`, async () => {
    const {api, calls} = openBackground({style});
    for (const event of [api.runtime.onInstalled, api.runtime.onStartup]) await event.listeners[0]();
    const created = calls.filter(([name]) => name === 'create').map(([, options]) => JSON.parse(JSON.stringify(options)));
    assert.deepEqual(calls.map(([name]) => name), ['removeAll', 'create', 'removeAll', 'create']);
    assert.deepEqual(created[0], {id: 'always-show-creator', title: 'Always show this creator', contexts: ['all'], documentUrlPatterns: [...SITE_PAGE_PATTERNS]});
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
