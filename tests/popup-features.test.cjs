'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (filename) => readFileSync(path.join(SOURCE, filename), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openPopup(t, namespace, stored = {}, sendMessage) {
  const dom = new JSDOM(source('popup.html'), {url: 'https://extension.invalid/popup.html', runScripts: 'outside-only'});
  const writes = [];
  const openedTabs = [];
  dom.window[namespace] = {
    storage: {sync: {
      get: async () => stored,
      set: async (value) => {writes.push(value);},
    }},
    runtime: {getURL: (filename) => `https://extension.invalid/${filename}`, sendMessage},
    tabs: {create: async (options) => {openedTabs.push(options);}},
  };
  for (const name of ['settings.js', 'history-store.js', 'reason-breakdown.js', 'popup.js']) dom.window.eval(source(name));
  t.after(() => dom.window.close());
  const document = dom.window.document;
  return {
    document, writes, openedTabs,
    submit: () => document.querySelector('#settings-form').dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})),
  };
}

for (const namespace of ['browser', 'chrome']) {
  test(`${namespace}: popup loads and saves X ratio controls through sync storage`, async (t) => {
    const {document, writes, submit} = openPopup(t, namespace, {
      xLowLikeRatioEnabled: false, xMinimumLikePercent: 1.25,
      xHighLikeRatioEnabled: false, xKeepLikePercent: 4.5,
      xHighBookmarkRatioEnabled: true, xKeepBookmarkPercent: 0,
    });
    await tick();
    assert.equal(document.querySelector('#settings-form').noValidate, true);
    assert.equal(document.querySelector('#x-low-like-ratio-enabled').checked, false);
    assert.equal(document.querySelector('#x-minimum-like-percent').value, '1.25');
    assert.equal(document.querySelector('#x-high-like-ratio-enabled').checked, false);
    assert.equal(document.querySelector('#x-keep-like-percent').value, '4.5');
    assert.equal(document.querySelector('#x-high-bookmark-ratio-enabled').checked, true);
    assert.equal(document.querySelector('#x-keep-bookmark-percent').value, '0');
    for (const input of document.querySelectorAll('.percent-input input')) {
      assert.equal(input.step, '0.01');
      assert.equal(input.min, '0');
      assert.equal(input.max, '100');
    }
    document.querySelector('#x-low-like-ratio-enabled').checked = true;
    document.querySelector('#x-minimum-like-percent').value = '0.75';
    document.querySelector('#x-high-like-ratio-enabled').checked = true;
    document.querySelector('#x-keep-like-percent').value = '3.257';
    document.querySelector('#x-high-bookmark-ratio-enabled').checked = false;
    document.querySelector('#x-keep-bookmark-percent').value = '2.5';
    submit();
    await tick();
    assert.equal(writes.length, 1);
    assert.deepEqual([
      writes[0].xLowLikeRatioEnabled, writes[0].xMinimumLikePercent,
      writes[0].xHighLikeRatioEnabled, writes[0].xKeepLikePercent,
      writes[0].xHighBookmarkRatioEnabled, writes[0].xKeepBookmarkPercent,
    ], [true, 0.75, true, 3.257, false, 2.5]);
    assert.match(document.querySelector('#status').textContent, /Saved/);
  });
}

test('popup rejects an invalid ratio percentage without writing settings', async (t) => {
  const {document, writes, submit} = openPopup(t, 'browser');
  await tick();
  const input = document.querySelector('#x-keep-bookmark-percent');
  assert.equal(input.closest('details').open, false);
  input.value = '101';
  submit();
  await tick();
  assert.equal(writes.length, 0);
  assert.equal(input.closest('details').open, true);
  assert.equal(document.activeElement, input);
  assert.match(document.querySelector('#status').textContent, /percentage from 0 to 100/);
});

test('popup copies ratio settings and restores them from pasted transfer text', async (t) => {
  const {document, writes} = openPopup(t, 'browser', {
    xMinimumLikePercent: 0.25, xKeepLikePercent: 5,
    xHighBookmarkRatioEnabled: false, xKeepBookmarkPercent: 1.5,
  });
  await tick();
  document.querySelector('#copy-settings').click();
  await tick();
  const transferText = document.querySelector('#transfer-text');
  const transferred = JSON.parse(transferText.value);
  assert.equal(transferred.xMinimumLikePercent, 0.25);
  assert.equal(transferred.xKeepLikePercent, 5);
  assert.equal(transferred.xHighBookmarkRatioEnabled, false);
  assert.equal(transferred.xKeepBookmarkPercent, 1.5);
  document.querySelector('#x-minimum-like-percent').value = '9';
  document.querySelector('#x-high-bookmark-ratio-enabled').checked = true;
  document.querySelector('#load-settings').click();
  assert.equal(document.querySelector('#x-minimum-like-percent').value, '0.25');
  assert.equal(document.querySelector('#x-high-bookmark-ratio-enabled').checked, false);
  assert.equal(writes.length, 0);
});

test('filtered items button opens the extension history page', async (t) => {
  const {document, openedTabs} = openPopup(t, 'chrome');
  document.querySelector('#filtered-items').click();
  await tick();
  assert.equal(openedTabs.length, 1);
  assert.equal(openedTabs[0].url, 'https://extension.invalid/history.html');
});

test('popup shows hide statistics by site and reason, and whitelist sizes', async (t) => {
  const store = require('../src/history-store.js');
  let history = store.addEvents(null, [
    {site: 'x', outcome: 'hidden', url: null, title: '', reason: 'low-views', views: 10, likes: null, bookmarks: null},
    {site: 'x', outcome: 'hidden', url: null, title: '', reason: 'low-like-ratio', views: 5000, likes: 1, bookmarks: null},
    {site: 'x', outcome: 'hidden', url: null, title: '', reason: 'low-like-ratio', views: 5000, likes: 2, bookmarks: null},
  ], 'x', 1).history;
  history = store.addEvents(history, [{site: 'youtube', outcome: 'hidden', url: null, title: '', reason: 'unknown-views', views: null, likes: null, bookmarks: null}], 'youtube', 2).history;
  history = store.addEvents(history, [{site: 'x', outcome: 'kept', url: null, title: '', reason: 'high-bookmark-ratio', bypassedReason: 'low-views', views: 400, likes: 0, bookmarks: 2}], 'x', 3).history;
  const messages = [];
  const {document} = openPopup(t, 'chrome', {xWhitelist: ['nasa', 'spacex']}, async (message) => {
    messages.push(message);
    return {ok: true, history: JSON.parse(JSON.stringify(history))};
  });
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{type: 'minimum-views-filter:get-history'}]);
  assert.equal(document.querySelector('#stats-total').textContent, '4');
  const [xStats, youtubeStats] = document.querySelectorAll('#stats-sites .stats-site');
  assert.equal(xStats.querySelector('.stats-site-head').textContent, 'X3');
  assert.equal(xStats.querySelector('li[data-reason="low-like-ratio"] .reason-count').textContent, '2');
  assert.equal(xStats.querySelector('li[data-reason="low-like-ratio"] .reason-share').textContent, '67%');
  assert.equal(youtubeStats.querySelector('li[data-reason="unknown-views"] .reason-count').textContent, '1');
  const keptStats = document.querySelector('#stats-sites .stats-kept');
  assert.equal(keptStats.querySelector('.stats-site-head').textContent, 'X kept by high engagement1');
  assert.equal(keptStats.querySelector('li[data-reason="high-bookmark-ratio"] .reason-count').textContent, '1');
  assert.equal(document.querySelector('#stats-total').textContent, '4');
  assert.equal(document.querySelector('#x-whitelist-size').textContent, '2');
  assert.equal(document.querySelector('#youtube-whitelist-size').textContent, '');
  const textarea = document.querySelector('#youtube-whitelist');
  textarea.value = '@one, @two, @three';
  textarea.dispatchEvent(new textarea.ownerDocument.defaultView.Event('input'));
  assert.equal(document.querySelector('#youtube-whitelist-size').textContent, '3');
});

test('popup settings still work when statistics are unavailable', async (t) => {
  const {document} = openPopup(t, 'browser', {}, async () => ({ok: false, error: 'forbidden'}));
  await tick();
  assert.equal(document.querySelector('#stats-status').textContent, 'Statistics are unavailable right now.');
  assert.equal(document.querySelector('#controls').disabled, false);
});
