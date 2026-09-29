'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const {normalizeSettings} = require('../src/settings.js');

const SOURCE = path.join(__dirname, '..', 'src');
const source = (name) => readFileSync(path.join(SOURCE, name), 'utf8');
const wait = (milliseconds = 130) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const xCard = (id, views, author = 'author') => `<div data-testid="cellInnerDiv" id="cell-${id}"><article data-testid="tweet" id="post-${id}"><a href="/${author}/status/${id}"><time>Now</time></a><div data-testid="tweetText">An ordinary post</div>${views === null ? '' : `<a href="/${author}/status/${id}/analytics" aria-label="${views} views">${views}</a>`}</article></div>`;
const youtubeCard = (id, views, creator = '@author') => `<ytd-rich-item-renderer id="video-${id}"><ytd-rich-grid-media><a id="video-title" href="/watch?v=${id}">Video ${id}</a><ytd-channel-name><a href="/${creator}">Creator</a></ytd-channel-name><div id="metadata-line">${views === null ? '' : `<span>${views} views</span>`}<span>1 hour ago</span></div></ytd-rich-grid-media></ytd-rich-item-renderer>`;

/** Browser API mock: sync storage (writes notify listeners) and runtime messages. */
function createStorage({stored = {}, get, set} = {}) {
  const listeners = new Set();
  const messageListeners = new Set();
  const writes = [];
  const recordedMessages = [];
  const mock = {
    writes,
    recordedMessages,
    listeners,
    messageListeners,
    api: {
      storage: {
        sync: {
          get: get || (async () => stored),
          set: async (settings) => {
            writes.push(JSON.parse(JSON.stringify(settings)));
            if (set) await set(settings);
            Object.assign(stored, settings);
            mock.change(settings);
          },
        },
        onChanged: {
          addListener: (listener) => listeners.add(listener),
          removeListener: (listener) => listeners.delete(listener),
        },
      },
      runtime: {sendMessage: async (message) => {recordedMessages.push(JSON.parse(JSON.stringify(message))); return {ok: true};}, onMessage: {
        addListener: (listener) => messageListeners.add(listener),
        removeListener: (listener) => messageListeners.delete(listener),
      }},
    },
    change(values, area = 'sync') {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, {newValue}]));
      for (const listener of listeners) listener(changes, area);
    },
    /** Resolve with the value passed to sendResponse, or undefined if none is kept. */
    sendMessage(message) {
      return new Promise((resolve) => {
        let responded = false;
        let keepsChannel = false;
        // Browsers serialize responses; this also drops the page realm's prototypes.
        const sendResponse = (response) => { responded = true; resolve(response === undefined ? undefined : JSON.parse(JSON.stringify(response))); };
        for (const listener of messageListeners) keepsChannel = listener(message, {}, sendResponse) === true || keepsChannel;
        if (!keepsChannel && !responded) resolve(undefined);
      });
    },
  };
  return mock;
}

function openContent(t, {html, url = 'https://x.com/home', namespace = 'browser', visibilityState = 'visible', ...storageOptions}) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><style>${source('content.css')}</style></head><body>${html}</body></html>`, {url, runScripts: 'outside-only'});
  const storage = createStorage(storageOptions);
  dom.window[namespace] = storage.api;
  Object.defineProperty(dom.window.document, 'visibilityState', {value: visibilityState, configurable: true});
  for (const file of ['settings.js', 'filter-core.js']) dom.window.eval(source(file));
  const work = {getCards: 0, getViewCount: 0, getCreatorIdentifiers: 0, getXEngagement: 0, documentScans: 0};
  for (const name of ['getCards', 'getViewCount', 'getCreatorIdentifiers', 'getXEngagement']) {
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
  await Promise.resolve();
  assertVisible(window, '#cell-1', true);
  document.querySelector('#cell-1').innerHTML = '<article data-testid="tweet"><a href="/other/status/23"><time>Now</time></a><a href="/other/status/23/analytics" aria-label="999 views">999</a></article>';
  await Promise.resolve();
  assertVisible(window, '#cell-1', false);
});

test('X filters an inserted batch before a timer can expose its low-view cards', async (t) => {
  const {window, document, work} = openContent(t, {html: xCard(1, '2000')});
  await wait();
  const before = {...work};
  document.body.insertAdjacentHTML('beforeend', xCard(2, '999') + xCard(3, '1000') + xCard(4, null));
  // Mutation delivery is a microtask; do not advance to the next timer/paint task.
  await Promise.resolve();
  assertVisible(window, '#cell-2', false);
  assertVisible(window, '#cell-3', true);
  assertVisible(window, '#cell-4', true);
  assert.equal(work.getViewCount - before.getViewCount, 3);
  assert.equal(work.documentScans, before.documentScans);
  const after = {...work};
  await wait();
  assert.deepEqual(work, after, 'Own hiding marks must not cause another pass');
});

test('X applies hydrated counts and recycled links at their mutation checkpoint', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, null), stored: {xWhitelist: ['author']}});
  await wait();
  const article = document.querySelector('#post-1');
  article.insertAdjacentHTML('beforeend', '<a href="/author/status/1/analytics" aria-label="999 views" style="display:none">999</a>');
  await Promise.resolve();
  assertVisible(window, '#cell-1', true);
  for (const link of article.querySelectorAll('a[href]')) link.href = link.href.replace('/author/status/1', '/other/status/2');
  await Promise.resolve();
  assertVisible(window, '#cell-1', false);
  const counter = article.querySelector('a[href$="/analytics"]');
  counter.setAttribute('aria-label', '1000 views');
  await Promise.resolve();
  assertVisible(window, '#cell-1', true);
  assert.equal(counter.style.display, 'none', 'Preserve another extension\'s concealed counter');
  counter.remove();
  await Promise.resolve();
  assertVisible(window, '#cell-1', true);
  article.insertAdjacentHTML('beforeend', '<a href="/other/status/2/analytics" aria-label="999 views">999</a>');
  await Promise.resolve();
  assertVisible(window, '#cell-1', false);
});

test('X flushes pending settings with new cards and cancels the obsolete timer', async (t) => {
  const {window, document, storage, work} = openContent(t, {html: xCard(1, '1500')});
  await wait();
  const before = {...work};
  storage.change({xMinimumViews: 2000, hideUnknown: true});
  document.body.insertAdjacentHTML('beforeend', xCard(2, '1999') + xCard(3, '2000') + xCard(4, null));
  await Promise.resolve();
  assertVisible(window, '#cell-1', false);
  assertVisible(window, '#cell-2', false);
  assertVisible(window, '#cell-3', true);
  assertVisible(window, '#cell-4', false);
  assert.equal(work.documentScans - before.documentScans, 1);
  const after = {...work};
  await wait();
  assert.deepEqual(work, after, 'The superseded timeout must not repeat the scan');
});

test('X mutation-driven navigation reconciles immediately and excluded pages stay idle', async (t) => {
  const {window, document, work} = openContent(t, {html: xCard(1, '999')});
  await wait();
  window.history.pushState({}, '', '/search?q=example');
  document.body.insertAdjacentHTML('beforeend', xCard(2, '999'));
  await Promise.resolve();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-2', true);
  assert.equal(document.documentElement.hasAttribute('data-minimum-views-active'), false);
  const before = {...work};
  document.body.insertAdjacentHTML('beforeend', xCard(3, '999'));
  await Promise.resolve();
  assert.deepEqual(work, before);
  assertVisible(window, '#cell-3', true);
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
  storage.change({xEnabled: false}, 'local');
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
  assert.equal(storage.messageListeners.size, 0);
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
  const dom = new JSDOM(source('options.html'), {url: 'https://extension.invalid/options.html', runScripts: 'outside-only'});
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
    assert.deepEqual(storage.writes, [normalizeSettings({xMinimumViews: 2000, youtubeMinimumViews: 750, xWhitelist: ['nasa', 'spacex'], youtubeWhitelist: ['@science', 'channel/UCExample'], xEnabled: true, youtubeEnabled: false, hideUnknown: false})]);
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

test('youtube: gaining or losing a metadata class rereads that card', async (t) => {
  const html = '<ytd-rich-item-renderer id="video-1"><yt-lockup-view-model><a class="ytLockupMetadataViewModelTitle" href="/watch?v=1">Title</a><span id="count" class="pending">25 views</span></yt-lockup-view-model></ytd-rich-item-renderer>';
  const {window, document} = openContent(t, {url: 'https://www.youtube.com/', html});
  await wait();
  assertVisible(window, '#video-1', true);
  const count = document.querySelector('#count');
  count.className = 'pending ytContentMetadataViewModelMetadataText';
  await wait();
  assertVisible(window, '#video-1', false);
  count.className = 'hover ytContentMetadataViewModelMetadataText';
  await wait();
  assertVisible(window, '#video-1', false);
  count.className = 'pending';
  await wait();
  assertVisible(window, '#video-1', true);
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

  test(`${site}: repeated hover restyles do not reread the card`, async (t) => {
    const {window, document, work} = openContent(t, {url, html: Array.from({length: 10}, (_, index) => card(index, '800')).join('')});
    await wait();
    const before = {...work};
    const target = document.querySelector(site === 'x' ? '#post-1 [data-testid="tweetText"]' : '#video-1 [id="metadata-line"]');
    for (let index = 0; index < 5; index++) target.className = 'hover-' + index;
    await wait();
    assert.deepEqual(work, before);
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

const WHITELIST_MESSAGE = {type: 'minimum-views-filter:whitelist-creator'};
const rightClick = (window, element) => element.dispatchEvent(new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true}));

test('context menu whitelists the X card author, not a mentioned account, and reveals their posts', async (t) => {
  const {window, document, storage} = openContent(t, {html: xCard(1, '800', 'writer') + xCard(2, '300', 'writer') + xCard(3, '300', 'other')});
  document.querySelector('#post-1 [data-testid="tweetText"]').insertAdjacentHTML('beforeend', ' <a id="mention" href="/mentioned">@mentioned</a>');
  await wait();
  assertVisible(window, '#cell-1', false);
  rightClick(window, document.querySelector('#mention'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'added', identifier: 'writer'});
  assert.deepEqual(storage.writes, [{xWhitelist: ['writer']}]);
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-2', true);
  assertVisible(window, '#cell-3', false);
  rightClick(window, document.querySelector('#post-2 time'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'present', identifier: 'writer'});
  assert.equal(storage.writes.length, 1);
});

test('context menu stores the author but reports a switched-off whitelist', async (t) => {
  const {window, document, storage} = openContent(t, {html: xCard(1, '800', 'writer'), stored: {xWhitelistEnabled: false}});
  await wait();
  rightClick(window, document.querySelector('#post-1 time'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'switched-off', identifier: 'writer'});
  assert.deepEqual(storage.writes, [{xWhitelist: ['writer']}]);
  await wait();
  assertVisible(window, '#cell-1', false);
  rightClick(window, document.querySelector('#post-1 time'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'switched-off', identifier: 'writer'});
  assert.equal(storage.writes.length, 1);
});

test('context menu uses the right-clicked post when one X cell holds two posts', async (t) => {
  const html = '<div data-testid="cellInnerDiv" id="thread">' + xCard(1, '800', 'first').replace(/^<div[^>]*>|<\/div>$/g, '') + xCard(2, '800', 'second').replace(/^<div[^>]*>|<\/div>$/g, '') + '</div>';
  const {window, document, storage} = openContent(t, {html});
  await wait();
  rightClick(window, document.querySelector('#post-2 [data-testid="tweetText"]'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'added', identifier: 'second'});
});

test('context menu reports missing creators and never reuses an earlier right-click', async (t) => {
  const {window, document, storage} = openContent(t, {html: '<aside id="sidebar">Trends</aside>' + xCard(1, '800', 'writer')});
  await wait();
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'missing'});
  rightClick(window, document.querySelector('#sidebar'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'missing'});
  rightClick(window, document.querySelector('#post-1'));
  assert.equal((await storage.sendMessage(WHITELIST_MESSAGE)).result, 'added');
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'missing'});
  assert.equal(await storage.sendMessage({type: 'unrelated'}), undefined);
  assert.equal(storage.writes.length, 1);
});

test('context menu uses a YouTube channel link outside cards, including on excluded pages', async (t) => {
  const html = '<div id="owner"><a href="/@Owner">Owner</a><a id="video-link" href="/watch?v=abc">Video</a></div>' + youtubeCard(1, '500', '@Owner');
  const {window, document, storage} = openContent(t, {url: 'https://www.youtube.com/watch?v=abc', html, stored: {youtubeWhitelist: ['@kept']}});
  await wait();
  assertVisible(window, '#video-1', false);
  rightClick(window, document.querySelector('#video-link'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'missing'});
  rightClick(window, document.querySelector('#owner a'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'added', identifier: '@owner'});
  assert.deepEqual(storage.writes, [{youtubeWhitelist: ['@kept', '@owner']}]);
  await wait();
  assertVisible(window, '#video-1', true);
  window.history.pushState({}, '', '/results?search_query=example');
  rightClick(window, document.querySelector('#video-1 a#video-title'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'present', identifier: '@owner'});
});

test('context menu refuses to grow a whitelist past the sync item quota', async (t) => {
  const {oversizedSyncKeys} = require('../src/settings.js');
  const handles = [];
  // Fill to the largest list that fits one sync item; fillers match 'writer' in length.
  const filler = () => 'w' + String(handles.length).padStart(5, '0');
  while (!oversizedSyncKeys({xWhitelist: [...handles, filler()]}).length) handles.push(filler());
  const {window, document, storage} = openContent(t, {html: xCard(1, '800', 'writer'), stored: {xWhitelist: handles}});
  await wait();
  rightClick(window, document.querySelector('#post-1'));
  assert.deepEqual(await storage.sendMessage(WHITELIST_MESSAGE), {result: 'full', identifier: 'writer'});
  assert.equal(storage.writes.length, 0);
});

test('popup copies settings as text and loads pasted text for review before saving', async (t) => {
  const stored = {xMinimumViews: 10000, youtubeMinimumViews: 1500, xWhitelist: ['nasa'], youtubeWhitelist: ['@science'], xEnabled: true, youtubeEnabled: false, hideUnknown: true};
  const {window, document, storage, submit} = openPopup(t, {stored: {...stored}});
  await wait(0);
  document.querySelector('#copy-settings').click();
  await wait(0);
  const copied = document.querySelector('#transfer-text').value;
  assert.deepEqual(JSON.parse(copied), {format: 'minimum-views-filter-settings', ...normalizeSettings(stored)});
  assert.match(document.querySelector('#status').textContent, /Cop/);
  document.querySelector('#x-minimum-views').value = '5';
  document.querySelector('#x-whitelist').value = '';
  document.querySelector('#transfer-text').value = copied.replace('"nasa"', '"@SpaceX"');
  document.querySelector('#load-settings').click();
  assert.equal(document.querySelector('#x-minimum-views').value, '10000');
  assert.equal(document.querySelector('#x-whitelist').value, '@spacex');
  assert.equal(document.querySelector('#youtube-enabled').checked, false);
  assert.match(document.querySelector('#status').textContent, /Click Save/);
  assert.equal(storage.writes.length, 0);
  submit();
  await wait(0);
  assert.deepEqual(storage.writes, [normalizeSettings({...stored, xWhitelist: ['spacex']})]);
  assert.ok(window);
});

test('popup rejects invalid or empty pasted settings without changing the form', async (t) => {
  const {document, storage} = openPopup(t, {stored: {xMinimumViews: 2500}});
  await wait(0);
  const valid = JSON.parse(require('../src/settings.js').formatSettingsTransfer({}));
  for (const text of ['', 'not json', '[]', JSON.stringify({...valid, format: 'other'}), JSON.stringify({...valid, xMinimumViews: -1}),
    JSON.stringify({...valid, xWhitelist: ['Display Name']}), JSON.stringify({...valid, hideUnknown: 'yes'}), JSON.stringify({format: valid.format})]) {
    document.querySelector('#transfer-text').value = text;
    document.querySelector('#load-settings').click();
    assert.match(document.querySelector('#status').textContent, /Paste the complete text/, text);
    assert.equal(document.querySelector('#x-minimum-views').value, '2500');
  }
  assert.equal(storage.writes.length, 0);
});

test('popup blocks a whitelist too long to sync', async (t) => {
  const {document, storage, submit} = openPopup(t);
  await wait(0);
  document.querySelector('#youtube-whitelist').value = Array.from({length: 600}, (_, index) => '@creator-handle-' + index).join('\n');
  submit();
  await wait(0);
  assert.match(document.querySelector('#status').textContent, /YouTube whitelist is too long to sync/);
  assert.equal(document.activeElement, document.querySelector('#youtube-whitelist'));
  assert.equal(storage.writes.length, 0);
});

const xEngagementCard = (id, views, likes, bookmarks = null) => xCard(id, views).replace('</article>', `<button data-testid="like" aria-label="${likes} Likes. Like">${likes}</button>${bookmarks === null ? '' : `<button data-testid="bookmark" aria-label="${bookmarks} Bookmarks">${bookmarks}</button>`}</article>`);
const recordedItems = (storage) => storage.recordedMessages.flatMap((message) => message.items);
const historyItems = (storage) => recordedItems(storage).filter((item) => item.outcome === 'hidden');
const keptItems = (storage) => recordedItems(storage).filter((item) => item.outcome === 'kept');

for (const lowRule of [{xLowLikeRatioEnabled: false}, {xMinimumLikePercent: 0}]) {
  test('X skips irrelevant engagement reads but still rescues low-view cards: ' + JSON.stringify(lowRule), async (t) => {
    const {window, document, storage, work} = openContent(t, {
      html: xEngagementCard(1, '1000', 0) + xEngagementCard(2, '500', 10) + xEngagementCard(3, '500', 0),
      stored: {...lowRule, xBookmarkHighlightEnabled: false},
    });
    await wait();
    assert.equal(work.getXEngagement, 2);
    assertVisible(window, '#cell-1', true);
    assertVisible(window, '#cell-2', true);
    assertVisible(window, '#cell-3', false);
    assert.equal(keptItems(storage).length, 1);
    document.querySelector('#post-1 [data-testid="like"]').setAttribute('aria-label', '1 Likes');
    await wait();
    assert.equal(work.getXEngagement, 2);
    storage.change({xLowLikeRatioEnabled: true, xMinimumLikePercent: 0.5});
    await wait();
    assert.equal(work.getXEngagement, 5);
    assertVisible(window, '#cell-1', false);
    assertVisible(window, '#cell-2', true);
  });
}

test('X ratio decisions react to changed counts, missing likes, quote metrics and live settings', async (t) => {
  const {window, document, storage} = openContent(t, {html: xEngagementCard(1, '10000', 1) + xEngagementCard(2, '500', 10) + xEngagementCard(3, '400', 0, 2)});
  await wait();
  assertVisible(window, '#cell-1', false);
  assertVisible(window, '#cell-2', true);
  assertVisible(window, '#cell-3', true);
  document.querySelector('#post-1 [data-testid="like"]').setAttribute('aria-label', '50 Likes');
  await wait();
  assertVisible(window, '#cell-1', true);
  document.querySelector('#post-1 [data-testid="like"]').remove();
  document.querySelector('#post-1').insertAdjacentHTML('beforeend', '<div role="link"><button data-testid="like" aria-label="0 Likes">0</button></div>');
  storage.change({xMinimumLikePercent: 1});
  await wait();
  assertVisible(window, '#cell-1', true);
  storage.change({xKeepLikePercent: 3, xHighBookmarkRatioEnabled: false});
  await wait();
  assertVisible(window, '#cell-2', false);
  assertVisible(window, '#cell-3', false);
  storage.change({xWhitelist: ['author']});
  await wait();
  assertVisible(window, '#cell-2', true);
  assertVisible(window, '#cell-3', true);
  storage.change({xWhitelist: []});
  window.history.pushState({}, '', '/author');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait();
  assertVisible(window, '#cell-3', true);
});

test('history records hidden transitions and recycled identities, never rescans', async (t) => {
  const {window, document, storage} = openContent(t, {html: xEngagementCard(1, '10000', 1) + xEngagementCard(2, '500', 10)});
  await wait();
  assert.equal(historyItems(storage).length, 1);
  assert.equal(historyItems(storage)[0].reason, 'low-like-ratio');
  assert.equal(historyItems(storage)[0].url, 'https://x.com/author/status/1');
  assert.equal(historyItems(storage)[0].likes, 1);
  document.querySelector('#post-1 [data-testid="like"]').setAttribute('aria-label', '2 Likes');
  storage.change({xMinimumViews: 1100});
  await wait();
  assert.equal(historyItems(storage).length, 1);
  document.querySelector('#post-1 a time').closest('a').href = '/author/status/3';
  document.querySelector('#post-1 a[href$="/analytics"]').href = '/author/status/3/analytics';
  await wait();
  assert.equal(historyItems(storage).length, 2);
  assert.equal(historyItems(storage)[1].url, 'https://x.com/author/status/3');
  document.querySelector('#post-1 [data-testid="like"]').setAttribute('aria-label', '100 Likes');
  await wait();
  assertVisible(window, '#cell-1', true);
  document.querySelector('#post-1 [data-testid="like"]').setAttribute('aria-label', '0 Likes');
  await wait();
  assert.equal(historyItems(storage).length, 3);
});

test('history batches large scans, preserves YouTube decisions and tolerates reporting failure', async (t) => {
  const {window, document, storage} = openContent(t, {url: 'https://www.youtube.com/', html: Array.from({length: 205}, (_, id) => youtubeCard(id, '10')).join('')});
  await wait();
  assert.equal(historyItems(storage).length, 205);
  assert.equal(storage.recordedMessages.length, 3);
  assert.ok(storage.recordedMessages.every((message) => message.items.length <= 100));
  assert.ok(historyItems(storage).every((item) => item.reason === 'low-views' && item.site === 'youtube'));
  window.browser.runtime.sendMessage = async () => {throw new Error('storage unavailable');};
  document.body.insertAdjacentHTML('beforeend', youtubeCard(999, '1'));
  await wait();
  assertVisible(window, '#video-999', false);
});

test('a permalink arriving after a hidden card enriches history without another hide event', async (t) => {
  const {document, storage} = openContent(t, {url: 'https://www.youtube.com/', html: '<ytd-video-renderer><a id="video-title">Loading video</a><span class="inline-metadata-item">5 views</span></ytd-video-renderer>'});
  await wait();
  assert.equal(historyItems(storage).length, 1);
  assert.equal(historyItems(storage)[0].url, null);
  document.querySelector('a').textContent = 'Actual title';
  await wait();
  assert.equal(historyItems(storage).length, 1);
  document.querySelector('a').href = '/watch?v=newid';
  await wait();
  assert.equal(historyItems(storage).length, 2);
  assert.equal(historyItems(storage)[1].enrich, true);
  assert.equal(historyItems(storage)[1].title, 'Actual title');
  document.querySelector('a').href = '/watch?v=anotherid';
  await wait();
  assert.equal(historyItems(storage).length, 3);
  assert.equal(historyItems(storage)[2].enrich, undefined);
});

test('synchronous invalidated-extension reporting errors do not interrupt hiding or restoration', async (t) => {
  const {window, document} = openContent(t, {html: xCard(1, '10')});
  await wait();
  window.browser.runtime.sendMessage = () => {throw new Error('Extension context invalidated');};
  document.body.insertAdjacentHTML('beforeend', xCard(2, '10'));
  document.querySelector('#post-1 a[href$="/analytics"]').setAttribute('aria-label', '2000 views');
  await wait();
  assertVisible(window, '#cell-1', true);
  assertVisible(window, '#cell-2', false);
});

test('X posts kept by high engagement are recorded once per continuous kept state', async (t) => {
  // Post 2: 500 views is below the 1,000 minimum, but 10 likes = 2% keeps it.
  const {window, document, storage} = openContent(t, {html: xEngagementCard(1, '5000', 500) + xEngagementCard(2, '500', 10)});
  await wait();
  assertVisible(window, '#cell-2', true);
  assert.equal(historyItems(storage).length, 0);
  assert.equal(keptItems(storage).length, 1);
  assert.equal(keptItems(storage)[0].reason, 'high-like-ratio');
  assert.equal(keptItems(storage)[0].bypassedReason, 'low-views');
  assert.equal(keptItems(storage)[0].url, 'https://x.com/author/status/2');
  assert.equal(keptItems(storage)[0].likes, 10);
  document.querySelector('#post-2 [data-testid="like"]').setAttribute('aria-label', '11 Likes');
  await wait();
  assert.equal(keptItems(storage).length, 1);
  document.querySelector('#post-2 [data-testid="like"]').setAttribute('aria-label', '1 Likes');
  await wait();
  assertVisible(window, '#cell-2', false);
  assert.equal(historyItems(storage).length, 1);
  document.querySelector('#post-2 [data-testid="like"]').setAttribute('aria-label', '12 Likes');
  await wait();
  assertVisible(window, '#cell-2', true);
  assert.equal(keptItems(storage).length, 2);
  storage.change({xWhitelist: ['author']});
  document.querySelector('#post-2 [data-testid="like"]').setAttribute('aria-label', '1 Likes');
  await wait();
  document.querySelector('#post-2 [data-testid="like"]').setAttribute('aria-label', '13 Likes');
  await wait();
  assert.equal(keptItems(storage).length, 2);
  assert.equal(historyItems(storage).length, 1);
});

const highlightedItems = (storage) => recordedItems(storage).filter((item) => item.outcome === 'highlighted');
// These cards have 1% likes/views, below the 2% default likes condition; tests of
// the bookmark side switch that condition off.
const BOOKMARK_ONLY_HIGHLIGHT = {xHighlightLikeRequired: false};
const hasHighlight = (document, id = 1) => document.querySelector('#post-' + id).hasAttribute('data-minimum-views-highlighted');

test('X highlight reacts to strict boundaries, hidden counters, missing counts and recycled URLs', async (t) => {
  const {document, storage} = openContent(t, {html: xEngagementCard(1, '1000', 10, 10), stored: BOOKMARK_ONLY_HIGHLIGHT});
  await wait();
  assert.equal(hasHighlight(document), false);
  const bookmarks = document.querySelector('[data-testid="bookmark"]');
  bookmarks.style.display = 'none';
  bookmarks.setAttribute('aria-label', '11 Bookmarks');
  await wait();
  assert.equal(hasHighlight(document), true);
  assert.equal(highlightedItems(storage).length, 1);
  bookmarks.setAttribute('aria-label', '12 Bookmarks');
  await wait();
  assert.equal(highlightedItems(storage).length, 1);
  document.querySelector('a time').closest('a').href = '/author/status/2';
  document.querySelector('a[href$="/analytics"]').href = '/author/status/2/analytics';
  await wait();
  assert.equal(highlightedItems(storage).length, 2);
  assert.equal(highlightedItems(storage)[1].url, 'https://x.com/author/status/2');
  document.querySelector('a[href$="/analytics"]').setAttribute('aria-label', '1200 views');
  await wait();
  assert.equal(hasHighlight(document), false);
  bookmarks.remove();
  await wait();
  assert.equal(hasHighlight(document), false);
  document.querySelector('article').insertAdjacentHTML('beforeend', '<div role="link"><button data-testid="bookmark" aria-label="100 Bookmarks">100</button></div>');
  await wait();
  assert.equal(hasHighlight(document), false);
});

test('highlight alone never rescues a hidden card and can coexist with kept and whitelisted posts', async (t) => {
  const {window, document, storage} = openContent(t, {
    html: xEngagementCard(1, '500', 0, 20),
    stored: {...BOOKMARK_ONLY_HIGHLIGHT, xHighBookmarkRatioEnabled: false},
  });
  await wait();
  assertVisible(window, '#cell-1', false);
  assert.equal(hasHighlight(document), false);
  assert.equal(highlightedItems(storage).length, 0);
  storage.change({xHighBookmarkRatioEnabled: true});
  await wait();
  assertVisible(window, '#cell-1', true);
  assert.equal(hasHighlight(document), true);
  assert.equal(keptItems(storage).length, 1);
  assert.equal(highlightedItems(storage).length, 1);
  storage.change({xWhitelist: ['author'], xHighBookmarkRatioEnabled: false});
  await wait();
  assertVisible(window, '#cell-1', true);
  assert.equal(hasHighlight(document), true);
  assert.equal(highlightedItems(storage).length, 1);
  storage.change({xWhitelistEnabled: false});
  await wait();
  assertVisible(window, '#cell-1', false);
  assert.equal(hasHighlight(document), false);
});

test('highlight marks clean up on settings, route changes and lost identities without touching foreign state', async (t) => {
  const {window, document, storage} = openContent(t, {html: xEngagementCard(1, '1000', 10, 20), stored: BOOKMARK_ONLY_HIGHLIGHT});
  const card = document.querySelector('article');
  card.className = 'foreign';
  card.style.color = 'red';
  card.setAttribute('hidden', 'until-found');
  await wait();
  assert.equal(hasHighlight(document), true);
  storage.change({xHighlightBookmarkPercent: 2});
  await wait();
  assert.equal(hasHighlight(document), false);
  storage.change({xHighlightBookmarkPercent: 1, xBookmarkHighlightEnabled: false});
  await wait();
  assert.equal(hasHighlight(document), false);
  storage.change({xBookmarkHighlightEnabled: true});
  await wait();
  assert.equal(hasHighlight(document), true);
  window.history.pushState({}, '', '/search');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait();
  assert.equal(hasHighlight(document), false);
  window.history.pushState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait();
  assert.equal(hasHighlight(document), true);
  card.removeAttribute('data-testid');
  await wait();
  assert.equal(hasHighlight(document), false);
  assert.equal(card.className, 'foreign');
  assert.equal(card.getAttribute('style'), 'color: red;');
  assert.equal(card.getAttribute('hidden'), 'until-found');
});

test('statistics switch stops all recording while filters and highlight remain active', async (t) => {
  const {window, document, storage} = openContent(t, {
    html: xEngagementCard(1, '500', 0) + xEngagementCard(2, '1000', 10, 20),
    stored: {...BOOKMARK_ONLY_HIGHLIGHT, statisticsEnabled: false},
  });
  await wait();
  assertVisible(window, '#cell-1', false);
  assert.equal(hasHighlight(document, 2), true);
  assert.equal(recordedItems(storage).length, 0);
  storage.change({statisticsEnabled: true});
  await wait();
  assert.equal(historyItems(storage).length, 1);
  assert.equal(highlightedItems(storage).length, 1);
  storage.change({statisticsEnabled: false});
  document.body.insertAdjacentHTML('beforeend', xEngagementCard(3, '400', 10, 10));
  await wait();
  assert.equal(recordedItems(storage).length, 2);
  assert.equal(hasHighlight(document, 3), true);
  storage.change({xEnabled: false});
  await wait();
  assert.equal(document.querySelectorAll('[data-minimum-views-highlighted]').length, 0);
  assertVisible(window, '#cell-1', true);
});

test('view minimum and whitelist switches apply independently on YouTube', async (t) => {
  const {window, storage} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '999') + youtubeCard(2, null), stored: {youtubeWhitelist: ['@author'], hideUnknown: true}});
  await wait();
  assertVisible(window, '#video-1', true);
  assertVisible(window, '#video-2', true);
  storage.change({youtubeWhitelistEnabled: false});
  await wait();
  assertVisible(window, '#video-1', false);
  assertVisible(window, '#video-2', false);
  storage.change({youtubeMinimumViewsEnabled: false});
  await wait();
  assertVisible(window, '#video-1', true);
  assertVisible(window, '#video-2', false);
  storage.change({hideUnknown: false});
  await wait();
  assertVisible(window, '#video-2', true);
});

test('hiding the feed highlight keeps recording qualifying posts until detection or statistics stop', async (t) => {
  const {document, storage} = openContent(t, {
    html: xEngagementCard(1, '1000', 10, 20),
    stored: {...BOOKMARK_ONLY_HIGHLIGHT, xBookmarkHighlightShown: false},
  });
  await wait();
  assert.equal(hasHighlight(document), false);
  assert.equal(highlightedItems(storage).length, 1);
  storage.change({xBookmarkHighlightShown: true});
  await wait();
  assert.equal(hasHighlight(document), true);
  // The same continuous state is not recorded again when only the edge changes.
  assert.equal(highlightedItems(storage).length, 1);
  storage.change({xBookmarkHighlightShown: false});
  await wait();
  assert.equal(hasHighlight(document), false);
  document.body.insertAdjacentHTML('beforeend', xEngagementCard(2, '1000', 10, 20));
  await wait();
  assert.equal(hasHighlight(document, 2), false);
  assert.equal(highlightedItems(storage).length, 2);
  storage.change({statisticsEnabled: false});
  document.body.insertAdjacentHTML('beforeend', xEngagementCard(3, '1000', 10, 20));
  await wait();
  assert.equal(highlightedItems(storage).length, 2);
  storage.change({statisticsEnabled: true, xBookmarkHighlightEnabled: false});
  document.body.insertAdjacentHTML('beforeend', xEngagementCard(4, '1000', 10, 20));
  await wait();
  assert.equal(highlightedItems(storage).length, 2);
  assert.equal(document.querySelectorAll('[data-minimum-views-highlighted]').length, 0);
});

test('default highlight needs both high bookmarks/views and high likes/views', async (t) => {
  // 1,000 views, 10 likes (1%), 20 bookmarks (2%): bookmarks qualify, likes do not.
  const {document, storage} = openContent(t, {html: xEngagementCard(1, '1000', 10, 20)});
  await wait();
  assert.equal(hasHighlight(document), false);
  assert.equal(highlightedItems(storage).length, 0);
  const like = document.querySelector('#post-1 [data-testid="like"]');
  like.setAttribute('aria-label', '20 Likes');
  await wait();
  assert.equal(hasHighlight(document), false);
  like.setAttribute('aria-label', '21 Likes');
  await wait();
  assert.equal(hasHighlight(document), true);
  assert.equal(highlightedItems(storage).length, 1);
  assert.equal(highlightedItems(storage)[0].likes, 21);
  // A removed likes counter is unknown, which cannot satisfy the condition.
  like.remove();
  await wait();
  assert.equal(hasHighlight(document), false);
  storage.change({xHighlightLikeRequired: false});
  await wait();
  assert.equal(hasHighlight(document), true);
});

test('YouTube filters inserted and hydrated cards before a timer can let them blink', async (t) => {
  const {window, document, work} = openContent(t, {url: 'https://www.youtube.com/', html: youtubeCard(1, '2000')});
  await wait();
  const before = {...work};
  document.body.insertAdjacentHTML('beforeend', youtubeCard(2, '999') + youtubeCard(3, '1000') + youtubeCard(4, null));
  // Mutation delivery is a microtask; do not advance to the next timer/paint task.
  await Promise.resolve();
  assertVisible(window, '#video-2', false);
  assertVisible(window, '#video-3', true);
  assertVisible(window, '#video-4', true);
  assert.equal(work.documentScans, before.documentScans);
  // A card whose count hydrates later is hidden at that mutation checkpoint.
  const card = document.querySelector('#video-4');
  card.insertAdjacentHTML('beforeend', '<div id="metadata-line"><span class="inline-metadata-item">12 views</span></div>');
  await Promise.resolve();
  assertVisible(window, '#video-4', false);
  const after = {...work};
  await wait();
  assert.deepEqual(work, after, 'Own hiding marks must not cause another pass');
});
