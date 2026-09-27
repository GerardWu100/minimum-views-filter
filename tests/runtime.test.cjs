'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (name) => readFileSync(path.join(SOURCE, name), 'utf8');
const wait = (milliseconds = 130) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const xCard = (id, views) => `<div data-testid="cellInnerDiv" id="cell-${id}"><article data-testid="tweet" id="post-${id}"><a href="/author/status/${id}"><time>Now</time></a><div data-testid="tweetText">An ordinary post</div>${views === null ? '' : `<a href="/author/status/${id}/analytics" aria-label="${views} views">${views}</a>`}</article></div>`;
const youtubeCard = (id, views) => `<ytd-rich-item-renderer id="video-${id}"><ytd-rich-grid-media><a id="video-title" href="/watch?v=${id}">Video ${id}</a><div id="metadata-line">${views === null ? '' : `<span>${views} views</span>`}<span>1 hour ago</span></div></ytd-rich-grid-media></ytd-rich-item-renderer>`;

function createStorage({stored = {}, get, set} = {}) {
  const listeners = new Set();
  const writes = [];
  return {
    writes,
    listeners,
    api: {storage: {
      local: {
        get: get || (async () => stored),
        set: async (settings) => {
          writes.push(JSON.parse(JSON.stringify(settings)));
          if (set) await set(settings);
        },
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    }},
    change(values, area = 'local') {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, {newValue}]));
      for (const listener of listeners) listener(changes, area);
    },
  };
}

function openContent(t, {html, url = 'https://x.com/home', namespace = 'browser', ...storageOptions}) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><style>${source('content.css')}</style></head><body>${html}</body></html>`, {url, runScripts: 'outside-only'});
  const storage = createStorage(storageOptions);
  dom.window[namespace] = storage.api;
  for (const file of ['settings.js', 'filter-core.js', 'content.js']) dom.window.eval(source(file));
  t.after(() => dom.window.close());
  return {window: dom.window, document: dom.window.document, storage};
}

function assertVisible(window, selector, visible) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected fixture ${selector}`);
  assert.equal(window.getComputedStyle(element).display !== 'none', visible, `${selector} visibility`);
}

for (const namespace of ['browser', 'chrome']) {
  test(`${namespace}: X hides below the floor and keeps the boundary and unknown counts`, async (t) => {
    const {window} = openContent(t, {namespace, html: xCard(1, '999') + xCard(2, '1,000') + xCard(3, null)});
    await wait();
    assertVisible(window, '#cell-1', false);
    assertVisible(window, '#cell-2', true);
    assertVisible(window, '#cell-3', true);
  });

  test(`${namespace}: YouTube filters new cards and reconsiders rising view counts`, async (t) => {
    const {window, document} = openContent(t, {namespace, url: 'https://www.youtube.com/', html: youtubeCard(1, '999') + youtubeCard(2, '1K') + youtubeCard(3, null)});
    await wait();
    assertVisible(window, '#video-1', false);
    assertVisible(window, '#video-2', true);
    assertVisible(window, '#video-3', true);
    document.querySelector('#video-1 #metadata-line span').firstChild.data = '1.1K views';
    document.body.insertAdjacentHTML('beforeend', youtubeCard(4, '25'));
    await wait();
    assertVisible(window, '#video-1', true);
    assertVisible(window, '#video-4', false);
  });
}

test('X releases a recycled timeline wrapper when its replacement post qualifies', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '10')});
  await wait();
  assertVisible(window, '#cell-1', false);
  document.querySelector('#cell-1').innerHTML = '<article data-testid="tweet"><a href="/other/status/22"><time>Now</time></a><a href="/other/status/22/analytics" aria-label="2,000 views">2K</a></article>';
  await wait();
  assertVisible(window, '#cell-1', true);
});

test('X count metadata changing in place restores the hidden wrapper', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '800')});
  await wait();
  document.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '1,100 views');
  await wait();
  assertVisible(window, '#cell-1', true);
});

test('navigation restores cards outside X Home and filters again on return', async (t) => {
  const {window} = openContent(t, {html: xCard(1, '100')});
  await wait();
  assertVisible(window, '#cell-1', false);
  window.history.pushState({}, '', '/author/status/1');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait();
  assertVisible(window, '#cell-1', true);
  window.history.pushState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait();
  assertVisible(window, '#cell-1', false);
});

test('SPA route changes without DOM mutations or navigation events restore excluded pages', async (t) => {
  const {window} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '100')});
  await wait();
  assertVisible(window, '#video-1', false);
  window.history.pushState({}, '', '/results?search_query=example');
  await wait(1100);
  assertVisible(window, '#video-1', true);
});

test('settings changes apply threshold, site enablement, and unknown-count policy immediately', async (t) => {
  const {window, storage} = openContent(t, {html: xCard(1, '900') + xCard(2, '1,200') + xCard(3, null)});
  await wait();
  storage.change({minimumViews: 1500});
  await wait();
  assertVisible(window, '#cell-2', false);
  storage.change({xEnabled: false});
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-2', true);
  storage.change({xEnabled: true, minimumViews: 500, hideUnknown: true});
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-3', false);
  storage.change({xEnabled: false}, 'sync');
  await wait();
  assertVisible(window, '#cell-3', false);
});

test('YouTube respects its own enable toggle independently of X', async (t) => {
  const {window, storage} = openContent(t, {url: 'https://www.youtube.com/watch?v=example', html: youtubeCard(1, '100'), stored: {xEnabled: false}});
  await wait();
  assertVisible(window, '#video-1', false);
  storage.change({youtubeEnabled: false});
  await wait();
  assertVisible(window, '#video-1', true);
});

test('storage read failure leaves the page usable and releases listeners', async (t) => {
  const {window, storage} = openContent(t, {html: xCard(1, '20'), get: async () => {throw new Error('Storage unavailable');}});
  await wait();
  assertVisible(window, '#cell-1', true);
  assert.equal(storage.listeners.size, 0);
});

test('settings arriving during startup preserve unchanged stored preferences', async (t) => {
  let resolveRead;
  const {window, storage} = openContent(t, {html: xCard(1, '1,500'), get: () => new Promise((resolve) => {resolveRead = resolve;})});
  storage.change({minimumViews: 2000});
  resolveRead({xEnabled: false, minimumViews: 1000});
  await wait();
  assertVisible(window, '#cell-1', true);
  storage.change({xEnabled: true});
  await wait();
  assertVisible(window, '#cell-1', false);
});

test('page shutdown restores hidden cards and removes storage listeners', async (t) => {
  const {window, storage} = openContent(t, {html: xCard(1, '20')});
  await wait();
  assertVisible(window, '#cell-1', false);
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: false}));
  assertVisible(window, '#cell-1', true);
  assert.equal(storage.listeners.size, 0);
});

function openPopup(t, {namespace = 'browser', ...options} = {}) {
  const dom = new JSDOM(source('popup.html'), {url: 'https://extension.invalid/popup.html', runScripts: 'outside-only'});
  const storage = createStorage(options);
  dom.window[namespace] = storage.api;
  dom.window.eval(source('settings.js'));
  dom.window.eval(source('popup.js'));
  t.after(() => dom.window.close());
  const document = dom.window.document;
  return {
    window: dom.window, document, storage,
    submit: () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})),
  };
}

for (const namespace of ['browser', 'chrome']) {
  test(`${namespace}: popup loads preferences and saves edited controls`, async (t) => {
    const {document, storage, submit} = openPopup(t, {namespace, stored: {minimumViews: 5000, xEnabled: false, youtubeEnabled: true, hideUnknown: true}});
    await wait(0);
    assert.equal(document.querySelector('#controls').disabled, false);
    assert.equal(document.querySelector('#minimum-views').value, '5000');
    assert.equal(document.querySelector('#x-enabled').checked, false);
    assert.equal(document.querySelector('#hide-unknown').checked, true);
    document.querySelector('#minimum-views').value = '2000';
    document.querySelector('#x-enabled').checked = true;
    document.querySelector('#youtube-enabled').checked = false;
    document.querySelector('#hide-unknown').checked = false;
    submit();
    await wait(0);
    assert.deepEqual(storage.writes, [{minimumViews: 2000, xEnabled: true, youtubeEnabled: false, hideUnknown: false}]);
    assert.match(document.querySelector('#status').textContent, /Saved/);
    assert.equal(document.querySelector('#controls').disabled, false);
  });
}

test('popup rejects empty, fractional, negative, and oversized thresholds without saving', async (t) => {
  const {document, storage, submit} = openPopup(t);
  await wait(0);
  for (const value of ['', '1.5', '-1', '1000000000001']) {
    document.querySelector('#minimum-views').value = value;
    submit();
    await wait(0);
    assert.match(document.querySelector('#status').textContent, /whole number/);
  }
  assert.equal(storage.writes.length, 0);
});

test('popup reports load failure and keeps editing disabled', async (t) => {
  const {document} = openPopup(t, {get: async () => {throw new Error('Unavailable');}});
  await wait(0);
  assert.equal(document.querySelector('#controls').disabled, true);
  assert.match(document.querySelector('#status').textContent, /Could not load/);
});

test('popup reports save failure and permits a retry', async (t) => {
  let attempts = 0;
  const {document, storage, submit} = openPopup(t, {set: async () => {if (++attempts === 1) throw new Error('Unavailable');}});
  await wait(0);
  submit();
  await wait(0);
  assert.match(document.querySelector('#status').textContent, /Could not save/);
  assert.equal(document.querySelector('#controls').disabled, false);
  submit();
  await wait(0);
  assert.match(document.querySelector('#status').textContent, /Saved/);
  assert.equal(storage.writes.length, 2);
});

test('other extensions retain their inline display, hidden, and class state across filtering changes', async (t) => {
  const {window, document, storage} = openContent(t, {html: xCard(1, '100')});
  const cell = document.querySelector('#cell-1');
  const article = document.querySelector('#post-1');
  cell.setAttribute('style', 'display: none !important; color: red;');
  cell.setAttribute('hidden', '');
  cell.className = 'other-extension-filtered timeline-cell';
  article.setAttribute('style', 'display: none !important;');
  article.setAttribute('hidden', 'until-found');
  article.className = 'other-extension-filtered';
  const original = [cell, article].map((element) => ({style: element.getAttribute('style'), hidden: element.getAttribute('hidden'), class: element.getAttribute('class')}));
  const assertOtherState = () => {
    for (const [index, element] of [cell, article].entries()) {
      assert.equal(element.getAttribute('style'), original[index].style);
      assert.equal(element.getAttribute('hidden'), original[index].hidden);
      assert.equal(element.getAttribute('class'), original[index].class);
    }
    assertVisible(window, '#cell-1', false);
  };
  await wait();
  assert.equal(cell.hasAttribute('data-minimum-views-hidden'), true);
  assertOtherState();
  document.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '2,000 views');
  await wait();
  assert.equal(cell.hasAttribute('data-minimum-views-hidden'), false);
  assertOtherState();
  storage.change({minimumViews: 3000});
  await wait();
  assert.equal(cell.hasAttribute('data-minimum-views-hidden'), true);
  storage.change({xEnabled: false});
  await wait();
  assert.equal(cell.hasAttribute('data-minimum-views-hidden'), false);
  assertOtherState();
});

test('CSS-hidden view metadata is still read and removed metadata becomes visible unknown content', async (t) => {
  const {window, document} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '100')});
  const metadata = document.querySelector('#video-1 #metadata-line');
  metadata.style.setProperty('display', 'none', 'important');
  await wait();
  assertVisible(window, '#video-1', false);
  metadata.remove();
  await wait();
  assertVisible(window, '#video-1', true);
});

for (const [site, paths, fixture, lowSelector, unknownSelector] of [
  ['x', ['/search?q=example', '/i/lists/123', '/author'], xCard(1, '25') + xCard(2, null), '#cell-1', '#cell-2'],
  ['youtube', ['/results?search_query=example', '/feed/subscriptions', '/@creator/videos', '/playlist?list=example'], youtubeCard(1, '25') + youtubeCard(2, null), '#video-1', '#video-2'],
]) {
  test(`${site}: excluded pages preserve low and unknown counts even after new cards arrive`, async (t) => {
    for (const pathname of paths) {
      const host = site === 'x' ? 'x.com' : 'www.youtube.com';
      const {window, document} = openContent(t, {url: `https://${host}${pathname}`, html: fixture, stored: {hideUnknown: true}});
      await wait();
      assertVisible(window, lowSelector, true);
      assertVisible(window, unknownSelector, true);
      document.body.insertAdjacentHTML('beforeend', site === 'x' ? xCard(3, '1') : youtubeCard(3, '1'));
      await wait();
      assertVisible(window, site === 'x' ? '#cell-3' : '#video-3', true);
      assert.equal(document.querySelectorAll('[data-minimum-views-hidden]').length, 0, pathname);
    }
  });
}

for (const [placement, recommendation, recommendationSelector] of [
  ['beside', '<ytd-compact-video-renderer id="suggestion"><div id="metadata-line"><span>25 views</span></div></ytd-compact-video-renderer>', '#suggestion'],
  ['below', youtubeCard(1, '25'), '#video-1'],
]) {
  test(`YouTube watch recommendations ${placement} the player are filtered without hiding the player`, async (t) => {
    const player = '<div id="movie_player"><video id="playing"></video><span id="view-count">1 view</span></div>';
    const html = `<ytd-watch-flexy>${player}<div id="related">${recommendation}${youtubeCard(2, '1,000')}</div></ytd-watch-flexy>`;
    const {window, document} = openContent(t, {url: 'https://www.youtube.com/watch?v=playing&t=12', html});
    await wait();
    assertVisible(window, recommendationSelector, false);
    assertVisible(window, '#video-2', true);
    assertVisible(window, '#movie_player', true);
    assert.ok(document.getElementById('playing').isConnected);
    assert.equal(document.getElementById('movie_player').outerHTML, player);
  });
}

test('YouTube navigation restores search and channel cards, then filters watch recommendations and Home', async (t) => {
  const {window, document} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '25')});
  await wait();
  assertVisible(window, '#video-1', false);
  for (const [pathname, visible] of [
    ['/results?search_query=example', true],
    ['/watch?v=playing', false],
    ['/@creator/videos', true],
    ['/', false],
  ]) {
    window.history.pushState({}, '', pathname);
    document.dispatchEvent(new window.Event('yt-navigate-finish', {bubbles: true}));
    await wait();
    assertVisible(window, '#video-1', visible);
  }
});

test('X navigation to a list or search removes Home filtering from retained cards', async (t) => {
  const {window} = openContent(t, {html: xCard(1, '25')});
  await wait();
  assertVisible(window, '#cell-1', false);
  for (const [pathname, visible] of [
    ['/i/lists/123', true], ['/home', false], ['/search?q=example', true],
  ]) {
    window.history.pushState({}, '', pathname);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    await wait();
    assertVisible(window, '#cell-1', visible);
  }
});
