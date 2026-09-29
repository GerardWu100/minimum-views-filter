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

test('YouTube history never substitutes description or creator links for a missing own permalink', () => {
  const document = new JSDOM(`<ytd-video-renderer>
    <a id="video-title" href="/watch?v=own">Own video</a>
    <div id="description"><a href="/watch?v=unrelated">Related clip</a></div>
    <ytd-channel-name><a href="/watch?v=unrelated">Creator's featured video</a></ytd-channel-name>
    <span class="inline-metadata-item">999 views</span>
  </ytd-video-renderer>`).window.document;
  const card = document.body.firstElementChild;
  assert.deepEqual(core.getItemMetadata(card, 'youtube'), {url: 'https://www.youtube.com/watch?v=own', title: 'Own video'});
  // Title links may disappear during recycling or when another extension edits
  // the card; unrelated links must not become the filtered video's identity.
  card.querySelector('#video-title').removeAttribute('href');
  assert.deepEqual(core.getItemMetadata(card, 'youtube'), {url: null, title: 'Own video'});
  card.insertAdjacentHTML('afterbegin', '<a id="thumbnail" href="/watch?v=own&tracking=1"></a>');
  assert.deepEqual(core.getItemMetadata(card, 'youtube'), {url: 'https://www.youtube.com/watch?v=own', title: 'Own video'});
  card.querySelector('#thumbnail').remove();
  card.querySelector('#description').className = 'yt-lockup-metadata-view-model__description';
  card.querySelector('#description').removeAttribute('id');
  assert.deepEqual(core.getItemMetadata(card, 'youtube'), {url: null, title: 'Own video'});
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

test('decision reports which high-engagement rule kept a card and the hide rule it overrode', () => {
  const settings = normalizeSettings();
  const decide = (views, likes, bookmarks = null, override = {}, site = 'x') => ({...core.getFilterDecision(views, site, {...settings, ...override}, {likes, bookmarks})});
  // 500 views is below the 1,000 minimum; 10 likes = 2% reaches the keep threshold.
  assert.deepEqual(decide(500, 10), {reason: null, keptBy: 'high-like-ratio', bypassedReason: 'low-views'});
  // 0 likes fails the 0.5% minimum; 2 bookmarks / 400 views = 0.5% keeps it.
  assert.deepEqual(decide(400, 0, 2), {reason: null, keptBy: 'high-bookmark-ratio', bypassedReason: 'low-like-ratio'});
  // Both exceptions qualify: likes are credited.
  assert.deepEqual(decide(500, 10, 10), {reason: null, keptBy: 'high-like-ratio', bypassedReason: 'low-views'});
  // High engagement on a post that passes anyway is not a rescue.
  assert.deepEqual(decide(5000, 500), {reason: null, keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 9), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 10, null, {xHighLikeRatioEnabled: false}), {reason: 'low-views', keptBy: null, bypassedReason: null});
  // Unknown or zero views cannot form a ratio, and YouTube has no exceptions.
  assert.deepEqual(decide(null, 10, 10, {hideUnknown: true}), {reason: 'unknown-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(0, 10, 10), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 500, 500, {}, 'youtube'), {reason: 'low-views', keptBy: null, bypassedReason: null});
});

test('bookmark highlighting is strict at integer and decimal thresholds and needs known positive views', () => {
  const settings = normalizeSettings({xHighlightBookmarkPercent: 1});
  assert.equal(core.shouldHighlightX(1000, 9, settings), false);
  assert.equal(core.shouldHighlightX(1000, 10, settings), false);
  assert.equal(core.shouldHighlightX(1000, 11, settings), true);
  assert.equal(core.shouldHighlightX(10000, 7, {...settings, xHighlightBookmarkPercent: 0.07}), false);
  assert.equal(core.shouldHighlightX(10000, 8, {...settings, xHighlightBookmarkPercent: 0.07}), true);
  for (const views of [null, 0]) assert.equal(core.shouldHighlightX(views, 100, settings), false);
  assert.equal(core.shouldHighlightX(1000, null, settings), false);
  assert.equal(core.shouldHighlightX(1000, 100, {...settings, xBookmarkHighlightEnabled: false}), false);
  assert.equal(core.shouldHighlightX(1000, 0, {...settings, xHighlightBookmarkPercent: 0}), false);
  assert.equal(core.shouldHighlightX(1000, 1, {...settings, xHighlightBookmarkPercent: 0}), true);
});

test('view-floor switches leave unknown-view and X engagement rules independent', () => {
  const settings = normalizeSettings({xMinimumViewsEnabled: false, youtubeMinimumViewsEnabled: false, hideUnknown: true});
  assert.equal(core.getFilterReason(999, 'x', settings), null);
  assert.equal(core.getFilterReason(999, 'youtube', settings), null);
  assert.equal(core.getFilterReason(null, 'youtube', settings), 'unknown-views');
  assert.equal(core.getFilterReason(999, 'x', settings, {likes: 0, bookmarks: null}), 'low-like-ratio');
});
