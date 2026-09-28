'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (filename) => readFileSync(path.join(SOURCE, filename), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openPopup(t, namespace, stored = {}) {
  const dom = new JSDOM(source('popup.html'), {url: 'https://extension.invalid/popup.html', runScripts: 'outside-only'});
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
  dom.window.eval(source('settings.js'));
  dom.window.eval(source('popup.js'));
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
  input.value = '101';
  submit();
  await tick();
  assert.equal(writes.length, 0);
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
