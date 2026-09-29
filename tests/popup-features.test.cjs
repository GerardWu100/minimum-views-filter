'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (filename) => readFileSync(path.join(SOURCE, filename), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openPage(t, page, namespace = 'browser', stored = {}) {
  const dom = new JSDOM(source(page), {url: `https://extension.invalid/${page}`, runScripts: 'outside-only'});
  const writes = [];
  const openedTabs = [];
  dom.window[namespace] = {
    storage: {sync: {
      get: async () => stored,
      set: async (value) => {writes.push(value);},
    }},
    runtime: {getURL: (filename) => `https://extension.invalid/${filename}`},
    tabs: {create: async (options) => {openedTabs.push(options);}},
  };
  for (const filename of page === 'popup.html' ? ['popup-nav.js'] : ['settings.js', 'popup.js']) {
    dom.window.eval(source(filename));
  }
  t.after(() => dom.window.close());
  const document = dom.window.document;
  return {
    document, writes, openedTabs,
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
    const {document, writes, submit, change} = openPage(t, 'options.html', namespace, {
      xMinimumViews: 1200, xMinimumLikePercent: 1.25,
      xHighLikeRatioEnabled: false, xKeepLikePercent: 4.5,
      xBookmarkHighlightEnabled: false, xHighlightBookmarkPercent: 1.8, xBookmarkHighlightShown: false,
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
    assert.equal(writes[0].xMinimumViewsEnabled, false);
    assert.equal(writes[0].xMinimumViews, 1200);
    assert.equal(writes[0].youtubeWhitelistEnabled, false);
    assert.equal(writes[0].statisticsEnabled, false);
    assert.equal(writes[0].hideUnknown, true);
    assert.equal(writes[0].xBookmarkHighlightEnabled, true);
    assert.equal(writes[0].xHighlightBookmarkPercent, 2.3);
    assert.equal(writes[0].xBookmarkHighlightShown, true);
    assert.equal(writes[0].xHighlightLikeRequired, true);
    assert.equal(writes[0].xHighlightLikePercent, 3.1);
    assert.equal(writes[0].xHighlightReplyRequired, false);
    assert.equal(writes[0].xHighlightReplyPercent, 0.1);
    assert.equal(writes[0].xHighReplyRatioEnabled, false);
    assert.equal(writes[0].xKeepReplyPercent, 0.1);
    assert.match(document.querySelector('#status').textContent, /Saved/);
  });
}

test('site and rule switches disable child editing without deleting stored values', async (t) => {
  const {document, writes, submit, change} = openPage(t, 'options.html', 'browser', {
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
  assert.equal(writes[0].xMinimumViews, 2500);
  assert.deepEqual(Array.from(writes[0].xWhitelist), ['nasa']);
  assert.equal(writes[0].xMinimumLikePercent, 0.7);
  assert.equal(writes[0].youtubeMinimumViews, 3500);
  assert.deepEqual(Array.from(writes[0].youtubeWhitelist), ['@science']);
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
  const {document, writes, submit, change} = openPage(t, 'options.html', 'browser', {
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
  assert.equal(writes[0].xMinimumViewsEnabled, false);
  assert.equal(writes[0].xWhitelistEnabled, false);
  assert.equal(writes[0].xLowLikeRatioEnabled, false);
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
