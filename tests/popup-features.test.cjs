'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const {applySettingsUpdate, normalizeSettings, UPDATE_SETTINGS_MESSAGE} = require('../src/settings.js');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (filename) => readFileSync(path.join(SOURCE, filename), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Mock sync storage shared by every page opened on it; set notifies all of them. */
function createSyncStorage(initial = {}) {
  const stored = {...initial};
  const writes = [];
  const listeners = new Set();
  const sync = {
    get: async () => ({...stored}),
    set: async (value) => {
      writes.push(JSON.parse(JSON.stringify(value)));
      Object.assign(stored, value);
      const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, {newValue}]));
      for (const listener of listeners) listener(changes, 'sync');
    },
  };
  return {stored, writes, listeners, sync};
}

/**
 * Open an extension page against mock sync storage. Settings saves go through
 * applySettingsUpdate like the background writer; stored is the live state.
 * options.storage shares storage between pages, options.get replaces this
 * page's reads, and options.beforeUpdate runs before the writer reads storage.
 */
function openPage(t, page, namespace = 'browser', initial = {}, options = {}) {
  const dom = new JSDOM(source(page), {url: `https://extension.invalid/${page}`, runScripts: 'outside-only'});
  const {stored, writes, listeners, sync} = options.storage || createSyncStorage(initial);
  const openedTabs = [];
  dom.window[namespace] = {
    storage: {sync: {...sync, get: options.get || sync.get}, onChanged: {addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener)}},
    runtime: {
      getURL: (filename) => `https://extension.invalid/${filename}`,
      sendMessage: async (message) => {
        assert.equal(message.type, UPDATE_SETTINGS_MESSAGE);
        await options.beforeUpdate?.();
        const outcome = applySettingsUpdate(await sync.get(), JSON.parse(JSON.stringify(message)));
        if (outcome.ok && Object.keys(outcome.changes).length) await sync.set(outcome.changes);
        return outcome.ok ? {ok: true} : {ok: false, error: outcome.error};
      },
    },
    tabs: {create: async (options) => {openedTabs.push(options);}},
  };
  for (const filename of page === 'popup.html' ? ['popup-nav.js'] : ['settings.js', 'popup.js']) {
    dom.window.eval(source(filename));
  }
  t.after(() => dom.window.close());
  const document = dom.window.document;
  return {
    document, writes, openedTabs, stored, sync,
    submit: () => document.querySelector('#settings-form').dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})),
    change: (selector, checked) => {
      const input = document.querySelector(selector);
      input.checked = checked;
      input.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    },
  };
}

for (const namespace of ['browser', 'chrome']) {
  test(`${namespace}: popup opens separate Settings and Statistics pages`, async (t) => {
    const {document, openedTabs} = openPage(t, 'popup.html', namespace);
    assert.equal(document.querySelector('#settings-form'), null);
    assert.equal(document.querySelector('#stats-total'), null);
    document.querySelector('#open-settings').click();
    document.querySelector('#open-statistics').click();
    await tick();
    assert.deepEqual(openedTabs.map(({url}) => url), [
      'https://extension.invalid/options.html',
      'https://extension.invalid/history.html',
    ]);
  });

  test(`${namespace}: Settings loads and saves every switch and threshold`, async (t) => {
    const {document, writes, stored, submit, change} = openPage(t, 'options.html', namespace, {
      xMinimumViews: 1200, xMinimumLikePercent: 1.25,
      xHighLikeRatioEnabled: false, xKeepLikePercent: 4.5,
      xBookmarkHighlightEnabled: false, xHighlightBookmarkPercent: 1.8, xBookmarkHighlightShown: false,
      xThreadContextEnabled: false,
    });
    await tick();
    assert.equal(document.title, 'Settings · Minimum Views Filter');
    assert.equal(document.querySelector('#stats-total'), null);
    assert.equal(document.querySelector('nav a').getAttribute('href'), 'history.html');
    assert.equal(document.querySelector('#x-minimum-views').value, '1200');
    assert.equal(document.querySelector('#x-keep-like-percent').value, '4.5');
    assert.equal(document.querySelector('#x-highlight-bookmark-percent').value, '1.8');
    assert.equal(document.querySelector('#x-highlight-bookmark-percent').disabled, true);
    assert.equal(document.querySelector('#x-bookmark-highlight-shown').checked, false);
    assert.equal(document.querySelector('#x-bookmark-highlight-shown').disabled, true);
    assert.equal(document.querySelector('#x-highlight-like-required').disabled, true);
    assert.equal(document.querySelector('#x-highlight-like-percent').disabled, true);
    assert.equal(document.querySelector('#x-thread-context-enabled').checked, false);
    change('#x-enabled', false);
    assert.equal(document.querySelector('#x-thread-context-enabled').disabled, true);
    change('#x-enabled', true);
    assert.equal(document.querySelector('#x-thread-context-enabled').disabled, false);
    change('#x-thread-context-enabled', true);
    change('#x-bookmark-highlight-enabled', true);
    assert.equal(document.querySelector('#x-highlight-like-percent').disabled, false);
    change('#x-highlight-like-required', false);
    assert.equal(document.querySelector('#x-highlight-like-percent').disabled, true);
    change('#x-highlight-like-required', true);
    document.querySelector('#x-highlight-like-percent').value = '3.1';
    assert.equal(document.querySelector('#x-highlight-reply-percent').disabled, false);
    change('#x-highlight-reply-required', false);
    assert.equal(document.querySelector('#x-highlight-reply-percent').disabled, true);
    change('#x-high-reply-ratio-enabled', false);
    assert.equal(document.querySelector('#x-keep-reply-percent').disabled, true);
    assert.equal(document.querySelector('#x-bookmark-highlight-shown').disabled, false);
    change('#x-bookmark-highlight-shown', true);
    document.querySelector('#x-highlight-bookmark-percent').value = '2.3';
    change('#x-minimum-views-enabled', false);
    change('#youtube-whitelist-enabled', false);
    change('#statistics-enabled', false);
    change('#hide-unknown', true);
    submit();
    await tick();
    assert.equal(writes.length, 1);
    // Raw storage omits never-changed defaults.
    const saved = normalizeSettings(stored);
    assert.equal(saved.xMinimumViewsEnabled, false);
    assert.equal(saved.xMinimumViews, 1200);
    assert.equal(saved.youtubeWhitelistEnabled, false);
    assert.equal(saved.statisticsEnabled, false);
    assert.equal(saved.hideUnknown, true);
    assert.equal(saved.xBookmarkHighlightEnabled, true);
    assert.equal(saved.xHighlightBookmarkPercent, 2.3);
    assert.equal(saved.xBookmarkHighlightShown, true);
    assert.equal(saved.xHighlightLikeRequired, true);
    assert.equal(saved.xHighlightLikePercent, 3.1);
    assert.equal(saved.xHighlightReplyRequired, false);
    assert.equal(saved.xHighlightReplyPercent, 0.1);
    assert.equal(saved.xHighReplyRatioEnabled, false);
    assert.equal(saved.xKeepReplyPercent, 0.1);
    assert.equal(saved.xThreadContextEnabled, true);
    assert.match(document.querySelector('#status').textContent, /Saved/);
  });
}

test('site and rule switches disable child editing without deleting stored values', async (t) => {
  const {document, writes, stored, submit, change} = openPage(t, 'options.html', 'browser', {
    xMinimumViews: 2500, xWhitelist: ['nasa'], xMinimumLikePercent: 0.7,
    youtubeMinimumViews: 3500, youtubeWhitelist: ['@science'],
  });
  await tick();
  change('#x-enabled', false);
  for (const selector of [
    '#x-minimum-views-enabled', '#x-minimum-views', '#x-whitelist-enabled', '#x-whitelist',
    '#x-low-like-ratio-enabled', '#x-minimum-like-percent', '#x-high-like-ratio-enabled',
    '#x-keep-like-percent', '#x-high-bookmark-ratio-enabled', '#x-keep-bookmark-percent',
    '#x-bookmark-highlight-enabled', '#x-highlight-bookmark-percent', '#x-bookmark-highlight-shown',
    '#x-highlight-like-required', '#x-highlight-like-percent',
    '#x-high-reply-ratio-enabled', '#x-keep-reply-percent',
    '#x-highlight-reply-required', '#x-highlight-reply-percent',
  ]) assert.equal(document.querySelector(selector).disabled, true, selector);
  assert.equal(document.querySelector('#youtube-enabled').disabled, false);
  assert.equal(document.querySelector('#hide-unknown').disabled, false);
  assert.equal(document.querySelector('#statistics-enabled').disabled, false);
  change('#youtube-minimum-views-enabled', false);
  change('#youtube-whitelist-enabled', false);
  assert.equal(document.querySelector('#youtube-minimum-views').disabled, true);
  assert.equal(document.querySelector('#youtube-whitelist').disabled, true);
  submit();
  await tick();
  // Only the two switches were edited, so only they are written.
  assert.deepEqual(writes, [{youtubeMinimumViewsEnabled: false, youtubeWhitelistEnabled: false, xEnabled: false}]);
  assert.equal(stored.xMinimumViews, 2500);
  assert.deepEqual(Array.from(stored.xWhitelist), ['nasa']);
  assert.equal(stored.xMinimumLikePercent, 0.7);
  assert.equal(stored.youtubeMinimumViews, 3500);
  assert.deepEqual(Array.from(stored.youtubeWhitelist), ['@science']);
});

test('Settings validates percentages and opens the affected section', async (t) => {
  const {document, writes, submit} = openPage(t, 'options.html');
  await tick();
  const input = document.querySelector('#x-highlight-bookmark-percent');
  input.value = '101';
  submit();
  await tick();
  assert.equal(writes.length, 0);
  assert.equal(input.closest('details').open, true);
  assert.match(document.querySelector('#status').textContent, /percentage from 0 to 100/);
});

test('switching off a rule restores invalid disabled input to its last saved value', async (t) => {
  const {document, writes, stored, submit, change} = openPage(t, 'options.html', 'browser', {
    xMinimumViews: 2100, xWhitelist: ['nasa'], xMinimumLikePercent: 0.8,
  });
  await tick();
  document.querySelector('#x-minimum-views').value = '';
  document.querySelector('#x-whitelist').value = 'not a handle';
  document.querySelector('#x-minimum-like-percent').value = '101';
  change('#x-minimum-views-enabled', false);
  change('#x-whitelist-enabled', false);
  change('#x-low-like-ratio-enabled', false);
  assert.equal(document.querySelector('#x-minimum-views').value, '2100');
  assert.equal(document.querySelector('#x-whitelist').value, '@nasa');
  assert.equal(document.querySelector('#x-minimum-like-percent').value, '0.8');
  submit();
  await tick();
  assert.equal(writes.length, 1);
  assert.equal(stored.xMinimumViewsEnabled, false);
  assert.equal(stored.xWhitelistEnabled, false);
  assert.equal(stored.xLowLikeRatioEnabled, false);
});

test('Settings exports and loads complete switch values without saving until requested', async (t) => {
  const {document, writes, change} = openPage(t, 'options.html', 'browser', {
    xMinimumViewsEnabled: false, statisticsEnabled: false,
    xBookmarkHighlightEnabled: false, xHighlightBookmarkPercent: 3.5,
  });
  await tick();
  document.querySelector('#copy-settings').click();
  await tick();
  const transferText = document.querySelector('#transfer-text');
  const transferred = JSON.parse(transferText.value);
  assert.equal(transferred.xMinimumViewsEnabled, false);
  assert.equal(transferred.statisticsEnabled, false);
  assert.equal(transferred.xBookmarkHighlightEnabled, false);
  assert.equal(transferred.xHighlightBookmarkPercent, 3.5);
  change('#x-bookmark-highlight-enabled', true);
  change('#statistics-enabled', true);
  document.querySelector('#load-settings').click();
  assert.equal(document.querySelector('#x-bookmark-highlight-enabled').checked, false);
  assert.equal(document.querySelector('#statistics-enabled').checked, false);
  assert.equal(document.querySelector('#x-highlight-bookmark-percent').disabled, true);
  assert.equal(writes.length, 0);
});

test('an old Settings page saves only its edit and keeps a whitelist entry added elsewhere', async (t) => {
  const storage = createSyncStorage({xWhitelist: ['nasa']});
  const {document, submit} = openPage(t, 'options.html', 'browser', {}, {storage});
  await tick();
  // Another tab adds a creator after this page loaded.
  await storage.sync.set({xWhitelist: ['nasa', 'spacex']});
  assert.equal(document.querySelector('#x-whitelist').value, '@nasa\n@spacex');
  document.querySelector('#youtube-minimum-views').value = '5000';
  submit();
  await tick();
  assert.deepEqual(normalizeSettings(storage.stored).xWhitelist, ['nasa', 'spacex']);
  assert.equal(storage.stored.youtubeMinimumViews, 5000);
  assert.deepEqual(storage.writes.at(-1), {youtubeMinimumViews: 5000});
  assert.match(document.querySelector('#status').textContent, /Saved/);
});

test('two Settings pages keep each other\'s saved edits and the explicit whitelist removal', async (t) => {
  const storage = createSyncStorage({xWhitelist: ['nasa']});
  const first = openPage(t, 'options.html', 'browser', {}, {storage});
  const second = openPage(t, 'options.html', 'chrome', {}, {storage});
  await tick();
  first.document.querySelector('#x-minimum-views').value = '3000';
  first.document.querySelector('#x-whitelist').value = '@nasa\n@first';
  second.document.querySelector('#youtube-minimum-views').value = '4000';
  second.document.querySelector('#x-whitelist').value = '';
  first.submit();
  await tick();
  // The second page follows the untouched minimum and keeps its whitelist draft.
  assert.equal(second.document.querySelector('#x-minimum-views').value, '3000');
  assert.equal(second.document.querySelector('#x-whitelist').value, '');
  assert.match(second.document.querySelector('#status').textContent, /unsaved edits are kept/);
  second.submit();
  await tick();
  const saved = normalizeSettings(storage.stored);
  assert.equal(saved.xMinimumViews, 3000);
  assert.equal(saved.youtubeMinimumViews, 4000);
  // nasa stays removed; the first page's addition survives the second page's save.
  assert.deepEqual(saved.xWhitelist, ['first']);
  assert.equal(second.document.querySelector('#x-whitelist').value, '@first');
});

test('Settings applies a change stored while its first read is still pending', async (t) => {
  const storage = createSyncStorage({xMinimumViews: 1000});
  let releaseRead;
  const get = () => {
    const snapshot = {...storage.stored};
    return new Promise((resolve) => { releaseRead = () => resolve(snapshot); });
  };
  const {document} = openPage(t, 'options.html', 'browser', {}, {storage, get});
  await storage.sync.set({xMinimumViews: 7000});
  releaseRead();
  await tick();
  assert.equal(document.querySelector('#x-minimum-views').value, '7000');
});

test('Settings shows a change stored during its own save once the save finishes', async (t) => {
  const storage = createSyncStorage({});
  const {document, submit} = openPage(t, 'options.html', 'browser', {}, {storage,
    beforeUpdate: () => storage.sync.set({youtubeMinimumViews: 6000, xWhitelist: ['spacex']})});
  await tick();
  document.querySelector('#x-minimum-views').value = '2500';
  document.querySelector('#x-whitelist').value = '@nasa';
  submit();
  await tick();
  const saved = normalizeSettings(storage.stored);
  assert.deepEqual([saved.xMinimumViews, saved.youtubeMinimumViews, saved.xWhitelist], [2500, 6000, ['spacex', 'nasa']]);
  assert.equal(document.querySelector('#youtube-minimum-views').value, '6000');
  assert.equal(document.querySelector('#x-whitelist').value, '@spacex\n@nasa');
  assert.match(document.querySelector('#status').textContent, /Saved/);
});

test('an unsaved edit outlasts a change elsewhere to the same setting and wins when saved', async (t) => {
  const storage = createSyncStorage({});
  const {document, submit} = openPage(t, 'options.html', 'browser', {}, {storage});
  await tick();
  document.querySelector('#x-minimum-views').value = '2000';
  await storage.sync.set({xMinimumViews: 3000});
  assert.equal(document.querySelector('#x-minimum-views').value, '2000');
  assert.match(document.querySelector('#status').textContent, /unsaved edits are kept/);
  submit();
  await tick();
  assert.equal(storage.stored.xMinimumViews, 2000);
});
