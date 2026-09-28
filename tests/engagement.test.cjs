'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const core = require('../src/filter-core.js');
const {normalizeSettings} = require('../src/settings.js');
const read = (html, locale = 'en') => core.getXEngagement(new JSDOM(`<article data-testid="tweet">${html}</article>`).window.document.querySelector('article'), locale);

test('own exact engagement labels outrank rounded counters and exclude quotes and body text', () => {
  assert.deepEqual(read(`<div data-testid="tweetText">999 likes <button data-testid="like" aria-label="999 likes"></button></div>
    <div role="link"><div role="group" aria-label="1M likes, 2M bookmarks"></div></div>
    <button data-testid="like" aria-label="1.2K Likes. Like" style="display:none">1.2K</button>
    <button data-testid="bookmark" aria-label="50 Bookmarks. Bookmark">50</button>
    <div role="group" aria-label="3 replies, 1,234 likes, 50 bookmarks, 100,000 views"></div>`), {likes: 1234, bookmarks: 50});
  assert.deepEqual(read('<button data-testid="unlike" aria-label="0 Likes. Liked">0</button><button data-testid="removeBookmark">2K</button>'), {likes: 0, bookmarks: 2000});
});

test('missing, removed, contradictory and foreign-language engagement remains unknown', () => {
  assert.deepEqual(read('<button data-testid="like" aria-label="Like"></button><button data-testid="bookmark" aria-label="Bookmark"></button>'), {likes: null, bookmarks: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="10 Likes">10</button><div role="group" aria-label="11 likes"></div>'), {likes: null, bookmarks: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="No likes"></button><button data-testid="bookmark" aria-label="0 Bookmarks"></button>'), {likes: 0, bookmarks: 0});
  assert.deepEqual(read('<button data-testid="like" aria-label="100 Likes">100</button>', 'ja'), {likes: null, bookmarks: null});
});

test('French engagement supports exact and abbreviated labels without guessing separators', () => {
  assert.deepEqual(read('<button data-testid="like" aria-label="1 234 J’aime. Aimer">1,2 k</button><div role="group" aria-label="1 234 J’aime, 1,2 k signets, 10 000 vues"></div>', 'fr-CA'), {likes: 1234, bookmarks: 1200});
  assert.deepEqual(read('<button data-testid="like" aria-label="Aucun J’aime"></button><button data-testid="bookmark" aria-label="Aucun signet"></button>', 'fr'), {likes: 0, bookmarks: 0});
});

test('ratio boundaries, OR rescue precedence and zero or unknown denominator are explicit', () => {
  const settings = normalizeSettings();
  const reason = (views, likes, bookmarks = null, override = {}) => core.getFilterReason(views, 'x', {...settings, ...override}, {likes, bookmarks});
  assert.equal(reason(10000, 49), 'low-like-ratio');
  assert.equal(reason(10000, 50), null);
  assert.equal(reason(500, 9), 'low-views');
  assert.equal(reason(500, 10), null);
  assert.equal(reason(400, 0, 2), null);
  assert.equal(reason(400, 0, 1), 'low-like-ratio');
  assert.equal(reason(10000, null), null);
  assert.equal(reason(400, null), 'low-views');
  assert.equal(reason(null, 9999, 9999), null);
  assert.equal(reason(null, 9999, 9999, {hideUnknown: true}), 'unknown-views');
  assert.equal(reason(0, 10, 10), 'low-views');
  assert.equal(reason(0, 10, 10, {xMinimumViews: 0}), null);
  assert.equal(reason(10000, 0, 100, {xHighBookmarkRatioEnabled: false}), 'low-like-ratio');
  assert.equal(reason(500, 10, null, {xHighLikeRatioEnabled: false}), 'low-views');
  assert.equal(reason(10000, 0, null, {xLowLikeRatioEnabled: false}), null);
  assert.equal(core.getFilterReason(999, 'youtube', settings, {likes: 999, bookmarks: 999}), 'low-views');
  assert.equal(core.getFilterReason(1000, 'youtube', settings, {likes: 0, bookmarks: 0}), null);
});

test('history identifies own permalinks and strips tracking without using quoted items', () => {
  let document = new JSDOM('<article data-testid="tweet"><div role="link"><a href="/quote/status/2"><time>Now</time></a><div data-testid="tweetText">Quote</div></div><div data-testid="tweetText">Own text</div><a href="/Author/status/1?s=20"><time>Now</time></a></article>').window.document;
  assert.deepEqual(core.getItemMetadata(document.querySelector('article'), 'x'), {url: 'https://x.com/author/status/1', title: 'Own text'});
  document = new JSDOM('<ytd-rich-item-renderer><a id="video-title" href="/watch?v=abc123&list=tracking">Video title</a></ytd-rich-item-renderer>').window.document;
  assert.deepEqual(core.getItemMetadata(document.body.firstChild, 'youtube'), {url: 'https://www.youtube.com/watch?v=abc123', title: 'Video title'});
  document.querySelector('a').href = 'https://evil.example/watch?v=abc123';
  assert.equal(core.getItemMetadata(document.body.firstChild, 'youtube').url, null);
});

test('exact view labels across the card take precedence over rounded counters for ratio decisions', () => {
  const document = new JSDOM('<article data-testid="tweet"><a href="/author/status/1/analytics" aria-label="1.2K views">1.2K</a><div role="group" aria-label="1,234 views, 6 likes"></div></article>').window.document;
  const card = document.querySelector('article');
  const views = core.getViewCount(card, 'x');
  assert.equal(views, 1234);
  assert.equal(core.getFilterReason(views, 'x', normalizeSettings(), core.getXEngagement(card)), 'low-like-ratio');
  card.querySelector('a').setAttribute('aria-label', '1,235 views');
  assert.equal(core.getViewCount(card, 'x'), null);
  const yt = new JSDOM('<ytd-video-renderer><a id="video-title" href="/watch?v=a" aria-label="Title 1,234 views">Title</a><span class="inline-metadata-item">1.2K views</span></ytd-video-renderer>').window.document.body.firstChild;
  assert.equal(core.getViewCount(yt, 'youtube'), 1234);
});

test('decimal percentages include exact boundaries without accepting a materially higher threshold', () => {
  const metrics = {likes: 7, bookmarks: 7};
  const settings = normalizeSettings({xMinimumLikePercent: 0.07, xHighLikeRatioEnabled: false, xHighBookmarkRatioEnabled: false});
  assert.equal(core.getFilterReason(10000, 'x', settings, metrics), null);
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumLikePercent: 0.0700001}, metrics), 'low-like-ratio');
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumViews: 20000, xHighLikeRatioEnabled: true, xKeepLikePercent: 0.07}, metrics), null);
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumViews: 20000, xHighBookmarkRatioEnabled: true, xKeepBookmarkPercent: 0.07}, metrics), null);
});
