'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (name) => readFileSync(path.join(SOURCE, name), 'utf8');
const wait = (milliseconds = 130) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const xCard = (id, views, author = 'author') => `<div data-testid="cellInnerDiv" id="cell-${id}"><article data-testid="tweet" id="post-${id}"><a href="/${author}/status/${id}"><time>Now</time></a><div data-testid="tweetText">An ordinary post</div>${views === null ? '' : `<a href="/${author}/status/${id}/analytics" aria-label="${views} views">${views}</a>`}</article></div>`;
const youtubeCard = (id, views, creator = '@author') => `<ytd-rich-item-renderer id="video-${id}"><ytd-rich-grid-media><a id="video-title" href="/watch?v=${id}">Video ${id}</a><ytd-channel-name><a href="/${creator}">Creator</a></ytd-channel-name><div id="metadata-line">${views === null ? '' : `<span>${views} views</span>`}<span>1 hour ago</span></div></ytd-rich-grid-media></ytd-rich-item-renderer>`;

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

function openContent(t, {html, url = 'https://x.com/home', namespace = 'browser', visibilityState = 'visible', ...storageOptions}) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><style>${source('content.css')}</style></head><body>${html}</body></html>`, {url, runScripts: 'outside-only'});
  const storage = createStorage(storageOptions);
  dom.window[namespace] = storage.api;
  Object.defineProperty(dom.window.document, 'visibilityState', {value: visibilityState, configurable: true});
  for (const file of ['settings.js', 'filter-core.js']) dom.window.eval(source(file));
  const work = {getCards: 0, getViewCount: 0, getCreatorIdentifiers: 0, documentScans: 0};
  for (const name of ['getCards', 'getViewCount', 'getCreatorIdentifiers']) {
    const original = dom.window.MinimumViewsCore[name];
    dom.window.MinimumViewsCore[name] = (...args) => {
      work[name]++;
      if (name === 'getCards' && args[0] === dom.window.document) work.documentScans++;
      return original(...args);
    };
  }
  dom.window.eval(source('content.js'));
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', {persisted: false}));
    dom.window.close();
  });
  return {window: dom.window, document: dom.window.document, storage, work,
    setVisibility(state) {
      Object.defineProperty(dom.window.document, 'visibilityState', {value: state, configurable: true});
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    },
  };
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
    document.querySelector('#video-1 [id="metadata-line"] span').firstChild.data = '1.1K views';
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
  storage.change({xMinimumViews: 1500});
  await wait();
  assertVisible(window, '#cell-2', false);
  storage.change({xEnabled: false});
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-2', true);
  storage.change({xEnabled: true, xMinimumViews: 500, hideUnknown: true});
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
  storage.change({xMinimumViews: 2000});
  resolveRead({xEnabled: false, xMinimumViews: 1000});
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
    const {document, storage, submit} = openPopup(t, {namespace, stored: {xMinimumViews: 5000, youtubeMinimumViews: 2500, xWhitelist: ['nasa'], youtubeWhitelist: ['@science'], xEnabled: false, youtubeEnabled: true, hideUnknown: true}});
    await wait(0);
    assert.equal(document.querySelector('#controls').disabled, false);
    assert.equal(document.querySelector('#x-minimum-views').value, '5000');
    assert.equal(document.querySelector('#youtube-minimum-views').value, '2500');
    assert.equal(document.querySelector('#x-whitelist').value, '@nasa');
    assert.equal(document.querySelector('#youtube-whitelist').value, '@science');
    assert.equal(document.querySelector('#x-enabled').checked, false);
    assert.equal(document.querySelector('#hide-unknown').checked, true);
    document.querySelector('#x-minimum-views').value = '2000';
    document.querySelector('#youtube-minimum-views').value = '750';
    document.querySelector('#x-whitelist').value = '@NASA, https://x.com/NASA\n@SpaceX';
    document.querySelector('#youtube-whitelist').value = '@Science, https://www.youtube.com/@SCIENCE\nhttps://www.youtube.com/channel/UCExample';
    document.querySelector('#x-enabled').checked = true;
    document.querySelector('#youtube-enabled').checked = false;
    document.querySelector('#hide-unknown').checked = false;
    submit();
    await wait(0);
    assert.deepEqual(storage.writes, [{xMinimumViews: 2000, youtubeMinimumViews: 750, xWhitelist: ['nasa', 'spacex'], youtubeWhitelist: ['@science', 'channel/UCExample'], xEnabled: true, youtubeEnabled: false, hideUnknown: false}]);
    assert.match(document.querySelector('#status').textContent, /Saved/);
    assert.equal(document.querySelector('#controls').disabled, false);
  });
}

test('popup rejects empty, fractional, negative, and oversized thresholds without saving', async (t) => {
  const {document, storage, submit} = openPopup(t);
  await wait(0);
  for (const site of ['x', 'youtube']) {
    for (const value of ['', '1.5', '-1', '1000000000001']) {
      document.querySelector('#x-minimum-views').value = '1000';
      document.querySelector('#youtube-minimum-views').value = '1000';
      const input = document.querySelector('#' + site + '-minimum-views');
      input.value = value;
      submit();
      await wait(0);
      assert.match(document.querySelector('#status').textContent, /whole number/);
      assert.equal(document.activeElement, input);
    }
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
  storage.change({xMinimumViews: 3000});
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

test('each site applies and updates its own minimum independently', async (t) => {
  const stored = {xMinimumViews: 5000, youtubeMinimumViews: 1000};
  const x = openContent(t, {html: xCard(1, '2,000'), stored});
  const youtube = openContent(t, {url: 'https://www.youtube.com/watch?v=playing', html: youtubeCard(1, '2,000'), stored});
  await wait();
  assertVisible(x.window, '#cell-1', false);
  assertVisible(youtube.window, '#video-1', true);
  for (const page of [x, youtube]) page.storage.change({xMinimumViews: 1500});
  await wait();
  assertVisible(x.window, '#cell-1', true);
  assertVisible(youtube.window, '#video-1', true);
  for (const page of [x, youtube]) page.storage.change({youtubeMinimumViews: 3000});
  await wait();
  assertVisible(x.window, '#cell-1', true);
  assertVisible(youtube.window, '#video-1', false);
});

test('zero minimum on YouTube does not disable the X threshold', async (t) => {
  const stored = {youtubeMinimumViews: 0};
  const x = openContent(t, {html: xCard(1, '0'), stored});
  const youtube = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '0'), stored});
  await wait();
  assertVisible(x.window, '#cell-1', false);
  assertVisible(youtube.window, '#video-1', true);
});

for (const site of ['x', 'youtube']) {
  test(`${site}: whitelist exempts low and unknown counts, updates immediately, and follows recycled creators`, async (t) => {
    const card = site === 'x' ? xCard : youtubeCard;
    const selector = site === 'x' ? '#cell-' : '#video-';
    const creator = site === 'x' ? 'author' : '@author';
    const url = site === 'x' ? 'https://x.com/home' : 'https://www.youtube.com/watch?v=playing';
    const {window, document, storage} = openContent(t, {url, html: card(1, '10') + card(2, null), stored: {hideUnknown: true}});
    await wait();
    assertVisible(window, selector + '1', false);
    assertVisible(window, selector + '2', false);
    storage.change({[site + 'Whitelist']: [creator]});
    await wait();
    assertVisible(window, selector + '1', true);
    assertVisible(window, selector + '2', true);
    document.querySelector(selector + '1').outerHTML = card(1, '10', site === 'x' ? 'other' : '@other');
    await wait();
    assertVisible(window, selector + '1', false);
    assertVisible(window, selector + '2', true);
    storage.change({[site + 'Whitelist']: []});
    await wait();
    assertVisible(window, selector + '2', false);
  });
}

test('X and YouTube whitelists remain independent even for identical handle names', async (t) => {
  const stored = {xWhitelist: ['author']};
  const x = openContent(t, {html: xCard(1, '10'), stored});
  const youtube = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '10'), stored});
  await wait();
  assertVisible(x.window, '#cell-1', true);
  assertVisible(youtube.window, '#video-1', false);
  for (const page of [x, youtube]) page.storage.change({xWhitelist: [], youtubeWhitelist: ['@author']});
  await wait();
  assertVisible(x.window, '#cell-1', false);
  assertVisible(youtube.window, '#video-1', true);
});

test('YouTube channel IDs retain case and whitelist updates preserve foreign hiding styles', async (t) => {
  const {window, document, storage} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '10', 'channel/UCAbC'), stored: {youtubeWhitelist: ['channel/UCabc']}});
  const card = document.querySelector('#video-1');
  card.style.setProperty('display', 'none', 'important');
  const originalStyle = card.getAttribute('style');
  await wait();
  assert.equal(card.hasAttribute('data-minimum-views-hidden'), true);
  storage.change({youtubeWhitelist: ['channel/UCAbC']});
  await wait();
  assert.equal(card.hasAttribute('data-minimum-views-hidden'), false);
  assert.equal(card.getAttribute('style'), originalStyle);
  assertVisible(window, '#video-1', false);
});

test('unknown creators cannot inherit a YouTube whitelist exemption and changed links are reconsidered', async (t) => {
  const {window, document} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '10'), stored: {youtubeWhitelist: ['@author']}});
  await wait();
  assertVisible(window, '#video-1', true);
  const link = document.querySelector('ytd-channel-name a');
  link.setAttribute('href', '/@other');
  await wait();
  assertVisible(window, '#video-1', false);
  link.setAttribute('href', '/@author');
  await wait();
  assertVisible(window, '#video-1', true);
  link.remove();
  await wait();
  assertVisible(window, '#video-1', false);
});

test('popup rejects invalid whitelist entries without dropping them or saving partial settings', async (t) => {
  const {document, storage, submit} = openPopup(t);
  await wait(0);
  for (const site of ['x', 'youtube']) {
    for (const value of ['https://example.org/@author', 'Creator Display Name', '@valid, https://x.com/home']) {
      document.querySelector('#x-whitelist').value = '';
      document.querySelector('#youtube-whitelist').value = '';
      const textarea = document.querySelector('#' + site + '-whitelist');
      textarea.closest('details').open = false;
      textarea.value = value;
      submit();
      await wait(0);
      assert.equal(textarea.value, value);
      assert.equal(textarea.closest('details').open, true);
      assert.equal(document.activeElement, textarea);
      assert.match(document.querySelector('#status').textContent, /one per line/);
    }
  }
  assert.equal(storage.writes.length, 0);
});

for (const site of ['x', 'youtube']) {
  const card = site === 'x' ? xCard : youtubeCard;
  const url = site === 'x' ? 'https://x.com/home' : 'https://www.youtube.com/watch?v=playing';
  const selector = site === 'x' ? '#cell-' : '#video-';

  test(`${site}: unrelated sidebar/player mutations do not reread the feed`, async (t) => {
    const html = '<aside id="sidebar"><span>Old</span></aside><div id="movie_player"><span>0:00</span></div>' + Array.from({length: 40}, (_, index) => card(index, '800')).join('');
    const {document, work} = openContent(t, {url, html});
    await wait();
    const before = {...work};
    document.querySelector('#sidebar span').firstChild.data = 'New';
    document.querySelector('#sidebar').className = 'changed';
    document.querySelector('#movie_player span').textContent = '0:01';
    document.querySelector('#movie_player').setAttribute('aria-label', 'Playing');
    await wait();
    assert.deepEqual(work, before);
  });

  test(`${site}: repeated hover restyles ${site === 'x' ? 'do not reread' : 'reread one'} card`, async (t) => {
    const {window, document, work} = openContent(t, {url, html: Array.from({length: 10}, (_, index) => card(index, '800')).join('')});
    await wait();
    const before = {...work};
    const target = document.querySelector(site === 'x' ? '#post-1 [data-testid="tweetText"]' : '#video-1 [id="metadata-line"]');
    for (let index = 0; index < 5; index++) target.className = 'hover-' + index;
    await wait();
    // X never reads class; YouTube metadata classes can establish a count.
    assert.equal(work.getViewCount - before.getViewCount, site === 'x' ? 0 : 1);
    assert.equal(work.documentScans, before.documentScans);
    assertVisible(window, selector + '1', false);
  });

  test(`${site}: a count change rereads one card and new cards avoid a document scan`, async (t) => {
    const {window, document, work} = openContent(t, {url, html: Array.from({length: 40}, (_, index) => card(index, '800')).join('')});
    await wait();
    const before = {...work};
    if (site === 'x') document.querySelector('#post-1 a[href$="/analytics"]').setAttribute('aria-label', '1500 views');
    else document.querySelector('#video-1 [id="metadata-line"] span').firstChild.data = '1500 views';
    await wait();
    assertVisible(window, selector + '1', true);
    assertVisible(window, selector + '2', false);
    assert.equal(work.getViewCount - before.getViewCount, 1);
    assert.equal(work.documentScans, before.documentScans);
    document.body.insertAdjacentHTML('beforeend', card(100, '25') + card(101, '1000'));
    await wait();
    assertVisible(window, selector + '100', false);
    assertVisible(window, selector + '101', true);
    assert.equal(work.getViewCount - before.getViewCount, 3);
    assert.equal(work.documentScans, before.documentScans);
  });

  test(`${site}: background mutations and settings wait for a full visible reconciliation`, async (t) => {
    const {window, document, storage, work, setVisibility} = openContent(t, {url, html: card(1, '800')});
    await wait();
    setVisibility('hidden');
    const before = {...work};
    storage.change({[site + 'MinimumViews']: 2000});
    document.body.insertAdjacentHTML('beforeend', card(2, '1500') + card(3, '2500'));
    if (site === 'x') document.querySelector('#post-1 a[href$="/analytics"]').setAttribute('aria-label', '3000 views');
    else document.querySelector('#video-1 [id="metadata-line"] span').firstChild.data = '3000 views';
    await wait();
    assert.deepEqual(work, before);
    setVisibility('visible');
    assertVisible(window, selector + '1', true);
    assertVisible(window, selector + '2', false);
    assertVisible(window, selector + '3', true);
    assert.equal(work.documentScans, before.documentScans + 1);
  });

  test(`${site}: an initially hidden page does no filtering until visible`, async (t) => {
    const {window, work, setVisibility} = openContent(t, {url, html: card(1, '25'), visibilityState: 'hidden'});
    await wait();
    assert.equal(work.getCards, 0);
    assert.equal(work.getViewCount, 0);
    setVisibility('visible');
    assertVisible(window, selector + '1', false);
  });
}

test('irrelevant site settings do not rescan X, and disabled card mutations remain idle', async (t) => {
  const {window, document, storage, work} = openContent(t, {html: xCard(1, '100')});
  await wait();
  const before = {...work};
  storage.change({youtubeMinimumViews: 5000, youtubeWhitelist: ['@example'], youtubeEnabled: false});
  await wait();
  assert.deepEqual(work, before);
  storage.change({xEnabled: false});
  await wait();
  const disabled = {...work};
  document.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '20 views');
  document.body.insertAdjacentHTML('beforeend', xCard(2, '10'));
  await wait();
  assert.deepEqual(work, disabled);
  assertVisible(window, '#cell-2', true);
  storage.change({xEnabled: true});
  await wait();
  assertVisible(window, '#cell-1', false);
  assertVisible(window, '#cell-2', false);
});

test('detached marked nodes cannot stay hidden when reinserted while filtering is disabled', async (t) => {
  const {window, document, storage} = openContent(t, {html: xCard(1, '100')});
  await wait();
  const cell = document.querySelector('#cell-1');
  cell.remove();
  storage.change({xEnabled: false});
  await wait();
  document.body.append(cell);
  await wait();
  assertVisible(window, '#cell-1', true);
  cell.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '2000 views');
  storage.change({xEnabled: true});
  await wait();
  assertVisible(window, '#cell-1', true);
  assert.equal(cell.hasAttribute('data-minimum-views-hidden'), false);
});

test('X reconciles a marked wrapper after its article loses card identity', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '100')});
  await wait();
  document.querySelector('#post-1').setAttribute('data-testid', 'other-content');
  await wait();
  assertVisible(window, '#cell-1', true);
  assert.equal(document.querySelector('[data-minimum-views-hidden]'), null);
});

test('X shared cells hide only the low post and collapse the cell once its high post is removed', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '100')});
  await wait();
  const cell = document.querySelector('#cell-1');
  const other = document.createElement('article');
  other.id = 'other';
  other.setAttribute('data-testid', 'tweet');
  other.innerHTML = '<a href="/other/status/2"><time>Now</time></a><a href="/other/status/2/analytics" aria-label="2000 views">2K</a>';
  cell.append(other);
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#post-1', false);
  assertVisible(window, '#other', true);
  other.remove();
  await wait();
  assertVisible(window, '#cell-1', false);
  assert.equal(document.querySelector('#post-1').hasAttribute('data-minimum-views-hidden'), false);
});

test('newly quoted X cards lose standalone marks and regain filtering when unquoted', async (t) => {
  const {window, document} = openContent(t, {html: '<div id="quote-wrapper">' + xCard(1, '100') + '</div>'});
  await wait();
  document.querySelector('#quote-wrapper').setAttribute('role', 'link');
  await wait();
  assertVisible(window, '#cell-1', true);
  document.querySelector('#quote-wrapper').removeAttribute('role');
  await wait();
  assertVisible(window, '#cell-1', false);
});

test('locale changes reconsider all visible cards without treating foreign counts as zero', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '100') + xCard(2, '2000')});
  await wait();
  document.documentElement.lang = 'ja';
  await wait();
  assertVisible(window, '#cell-1', true);
  document.documentElement.lang = 'en';
  await wait();
  assertVisible(window, '#cell-1', false);
});

test('large mutation bursts collapse to one full scan and preserve all card decisions', async (t) => {
  const {window, document, work} = openContent(t, {html: xCard(1, '100')});
  await wait();
  const before = {...work};
  document.body.insertAdjacentHTML('beforeend', Array.from({length: 70}, (_, index) => xCard(index + 10, index % 2 ? '1000' : '100')).join(''));
  await wait();
  assert.equal(work.documentScans, before.documentScans + 1);
  assertVisible(window, '#cell-10', false);
  assertVisible(window, '#cell-11', true);
  assert.equal(document.querySelectorAll('[data-minimum-views-hidden]').length, 36);
});

test('back-forward cache suspension drops work and resumes current cards', async (t) => {
  const {window, document, work} = openContent(t, {html: xCard(1, '100')});
  await wait();
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: true}));
  const before = {...work};
  document.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '2000 views');
  await wait();
  assert.deepEqual(work, before);
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', {persisted: true}));
  await wait();
  assertVisible(window, '#cell-1', true);
});

test('stopping before storage resolves cannot restart filtering or a navigation timer', async (t) => {
  let resolveRead;
  const {window, storage, work} = openContent(t, {html: xCard(1, '100'), get: () => new Promise(resolve => {resolveRead = resolve;})});
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: false}));
  resolveRead({xMinimumViews: 10000});
  await wait();
  assert.equal(work.getCards, 0);
  assert.equal(storage.listeners.size, 0);
  assertVisible(window, '#cell-1', true);
});

for (const pathname of ['/', '/watch?v=playing']) {
  test('YouTube compact metadata remains readable on ' + pathname, async (t) => {
    const html = '<ytd-rich-item-renderer id="compact-video"><yt-lockup-view-model><h3><a class="ytLockupMetadataViewModelTitle" href="/watch?v=example">Changed title</a></h3><span class="ytContentMetadataViewModelMetadataText"><a href="/@example">Creator</a></span><span class="ytContentMetadataViewModelMetadataText" aria-label="538 views" role="text">538</span><span class="ytContentMetadataViewModelMetadataText" aria-label="1 hour ago" role="text">1h ago</span></yt-lockup-view-model></ytd-rich-item-renderer>';
    const {window, document} = openContent(t, {url: 'https://www.youtube.com' + pathname, html});
    await wait();
    assertVisible(window, '#compact-video', false);
    document.querySelector('[aria-label="538 views"]').setAttribute('aria-label', '1.2 thousand views');
    await wait();
    assertVisible(window, '#compact-video', true);
  });
}
