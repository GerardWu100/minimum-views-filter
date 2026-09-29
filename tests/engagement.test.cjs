'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const core = require('../src/filter-core.js');
const {normalizeSettings} = require('../src/settings.js');
// Older ratio cases isolate likes and bookmarks; replies have their own tests.
const NO_REPLY_RULES = {xHighReplyRatioEnabled: false, xHighlightReplyRequired: false};
const read = (html, locale = 'en') => core.getXEngagement(new JSDOM(`<article data-testid="tweet">${html}</article>`).window.document.querySelector('article'), locale);

test('own exact engagement labels outrank rounded counters and exclude quotes and body text', () => {
  assert.deepEqual(read(`<div data-testid="tweetText">999 likes <button data-testid="like" aria-label="999 likes"></button></div>
    <div role="link"><div role="group" aria-label="1M likes, 2M bookmarks"></div></div>
    <button data-testid="like" aria-label="1.2K Likes. Like" style="display:none">1.2K</button>
    <button data-testid="bookmark" aria-label="50 Bookmarks. Bookmark">50</button>
    <div role="group" aria-label="3 replies, 1,234 likes, 50 bookmarks, 100,000 views"></div>`), {likes: 1234, bookmarks: 50, replies: 3});
  assert.deepEqual(read('<button data-testid="unlike" aria-label="0 Likes. Liked">0</button><button data-testid="removeBookmark">2K</button>'), {likes: 0, bookmarks: 2000, replies: null});
});

test('missing, removed, contradictory and foreign-language engagement remains unknown', () => {
  assert.deepEqual(read('<button data-testid="like" aria-label="Like"></button><button data-testid="bookmark" aria-label="Bookmark"></button>'), {likes: null, bookmarks: null, replies: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="10 Likes">10</button><div role="group" aria-label="11 likes"></div>'), {likes: null, bookmarks: null, replies: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="No likes"></button><button data-testid="bookmark" aria-label="0 Bookmarks"></button>'), {likes: 0, bookmarks: 0, replies: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="100 Likes">100</button>', 'ja'), {likes: null, bookmarks: null, replies: null});
});

test('French engagement supports exact and abbreviated labels without guessing separators', () => {
  assert.deepEqual(read('<button data-testid="like" aria-label="1 234 J’aime. Aimer">1,2 k</button><div role="group" aria-label="1 234 J’aime, 1,2 k signets, 10 000 vues"></div>', 'fr-CA'), {likes: 1234, bookmarks: 1200, replies: null});
  assert.deepEqual(read('<button data-testid="like" aria-label="Aucun J’aime"></button><button data-testid="bookmark" aria-label="Aucun signet"></button>', 'fr'), {likes: 0, bookmarks: 0, replies: null});
});

test('ratio boundaries, AND rescue and zero or unknown denominator are explicit', () => {
  const settings = normalizeSettings(NO_REPLY_RULES);
  const reason = (views, likes, bookmarks = null, override = {}) => core.getFilterReason(views, 'x', {...settings, ...override}, {likes, bookmarks});
  assert.equal(reason(10000, 49), 'low-like-ratio');
  assert.equal(reason(10000, 50), null);
  assert.equal(reason(500, 9), 'low-views');
  // Rescue needs likes/views >= 2% AND bookmarks/views >= 0.5% by default.
  assert.equal(reason(500, 10), 'low-views');
  assert.equal(reason(500, 10, 2), 'low-views');
  assert.equal(reason(500, 10, 3), null);
  assert.equal(reason(400, 0, 2), 'low-like-ratio');
  assert.equal(reason(400, 0, 2, {xHighLikeRatioEnabled: false}), null);
  assert.equal(reason(400, 0, 1, {xHighLikeRatioEnabled: false}), 'low-like-ratio');
  assert.equal(reason(10000, null), null);
  assert.equal(reason(400, null), 'low-views');
  assert.equal(reason(null, 9999, 9999), null);
  assert.equal(reason(null, 9999, 9999, {hideUnknown: true}), 'unknown-views');
  assert.equal(reason(0, 10, 10), 'low-views');
  assert.equal(reason(0, 10, 10, {xMinimumViews: 0}), null);
  assert.equal(reason(10000, 0, 100, {xHighBookmarkRatioEnabled: false}), 'low-like-ratio');
  assert.equal(reason(500, 10, null, {xHighLikeRatioEnabled: false}), 'low-views');
  assert.equal(reason(500, 10, null, {xHighBookmarkRatioEnabled: false}), null);
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
  const settings = normalizeSettings({...NO_REPLY_RULES, xMinimumLikePercent: 0.07, xHighLikeRatioEnabled: false, xHighBookmarkRatioEnabled: false});
  assert.equal(core.getFilterReason(10000, 'x', settings, metrics), null);
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumLikePercent: 0.0700001}, metrics), 'low-like-ratio');
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumViews: 20000, xHighLikeRatioEnabled: true, xKeepLikePercent: 0.07}, metrics), null);
  assert.equal(core.getFilterReason(10000, 'x', {...settings, xMinimumViews: 20000, xHighBookmarkRatioEnabled: true, xKeepBookmarkPercent: 0.07}, metrics), null);
});

test('decision reports a high-engagement keep and the hide rule it overrode', () => {
  const settings = normalizeSettings(NO_REPLY_RULES);
  const decide = (views, likes, bookmarks = null, override = {}, site = 'x') => ({...core.getFilterDecision(views, site, {...settings, ...override}, {likes, bookmarks})});
  // 500 views is below the 1,000 minimum. Defaults need likes/views >= 2% AND
  // bookmarks/views >= 0.5%: 10 likes = 2% and 3 bookmarks = 0.6% keep it.
  assert.deepEqual(decide(500, 10, 3), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  // Exact boundaries on both ratios keep: 16/800 = 2%, 4/800 = 0.5%.
  assert.deepEqual(decide(800, 16, 4), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  // One high ratio alone no longer rescues while both keep rules are on.
  assert.deepEqual(decide(500, 10, 2), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 9, 100), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 10), {reason: 'low-views', keptBy: null, bypassedReason: null});
  // 0 likes fails the 0.5% minimum and cannot satisfy the likes keep rule.
  assert.deepEqual(decide(400, 0, 2), {reason: 'low-like-ratio', keptBy: null, bypassedReason: null});
  // Switching one keep rule off keeps on the other ratio alone.
  assert.deepEqual(decide(500, 10, null, {xHighBookmarkRatioEnabled: false}), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  assert.deepEqual(decide(400, 0, 2, {xHighLikeRatioEnabled: false}), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-like-ratio'});
  // With both keep rules off, nothing is rescued.
  assert.deepEqual(decide(500, 500, 500, {xHighLikeRatioEnabled: false, xHighBookmarkRatioEnabled: false}), {reason: 'low-views', keptBy: null, bypassedReason: null});
  // High engagement on a post that passes anyway is not a rescue.
  assert.deepEqual(decide(5000, 500, 500), {reason: null, keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 9, 3), {reason: 'low-views', keptBy: null, bypassedReason: null});
  // Unknown or zero views cannot form a ratio, and YouTube has no exceptions.
  assert.deepEqual(decide(null, 10, 10, {hideUnknown: true}), {reason: 'unknown-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(0, 10, 10), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 500, 500, {}, 'youtube'), {reason: 'low-views', keptBy: null, bypassedReason: null});
});

test('bookmark highlighting is strict at integer and decimal thresholds and needs known positive views', () => {
  // The likes condition is off here; the next test covers the combined rule.
  const settings = normalizeSettings({...NO_REPLY_RULES, xHighlightBookmarkPercent: 1, xHighlightLikeRequired: false});
  const highlight = (views, bookmarks, overrides = {}) => core.shouldHighlightX(views, {likes: null, bookmarks}, {...settings, ...overrides});
  assert.equal(highlight(1000, 9), false);
  assert.equal(highlight(1000, 10), false);
  assert.equal(highlight(1000, 11), true);
  assert.equal(highlight(10000, 7, {xHighlightBookmarkPercent: 0.07}), false);
  assert.equal(highlight(10000, 8, {xHighlightBookmarkPercent: 0.07}), true);
  for (const views of [null, 0]) assert.equal(highlight(views, 100), false);
  assert.equal(highlight(1000, null), false);
  assert.equal(highlight(1000, 100, {xBookmarkHighlightEnabled: false}), false);
  assert.equal(highlight(1000, 0, {xHighlightBookmarkPercent: 0}), false);
  assert.equal(highlight(1000, 1, {xHighlightBookmarkPercent: 0}), true);
});

test('highlighting with the likes condition needs both ratios strictly above their thresholds', () => {
  // Defaults: bookmarks/views > 1% AND likes/views > 2%.
  const settings = normalizeSettings(NO_REPLY_RULES);
  const highlight = (likes, bookmarks, overrides = {}) => core.shouldHighlightX(1000, {likes, bookmarks}, {...settings, ...overrides});
  assert.equal(highlight(21, 11), true);
  assert.equal(highlight(20, 11), false);
  assert.equal(highlight(21, 10), false);
  assert.equal(highlight(500, 5), false);
  assert.equal(highlight(5, 500), false);
  // Unknown likes cannot satisfy the condition; they never count as zero or as high.
  assert.equal(highlight(null, 11), false);
  assert.equal(highlight(null, 11, {xHighlightLikeRequired: false}), true);
  assert.equal(highlight(8, 11, {xHighlightLikePercent: 0.7}), true);
  assert.equal(highlight(7, 11, {xHighlightLikePercent: 0.7}), false);
});

test('view-floor switches leave unknown-view and X engagement rules independent', () => {
  const settings = normalizeSettings({xMinimumViewsEnabled: false, youtubeMinimumViewsEnabled: false, hideUnknown: true});
  assert.equal(core.getFilterReason(999, 'x', settings), null);
  assert.equal(core.getFilterReason(999, 'youtube', settings), null);
  assert.equal(core.getFilterReason(null, 'youtube', settings), 'unknown-views');
  assert.equal(core.getFilterReason(999, 'x', settings, {likes: 0, bookmarks: null}), 'low-like-ratio');
});

test('replies are read from own labels and buttons, never from quotes, and unknown stays null', () => {
  assert.equal(read('<div role="group" aria-label="12 replies, 3 reposts, 40 likes, 5 bookmarks, 9,000 views"></div>').replies, 12);
  assert.equal(read('<button data-testid="reply" aria-label="1 Reply. Reply">1</button>').replies, 1);
  assert.equal(read('<button data-testid="reply" aria-label="Reply"></button>').replies, null);
  assert.equal(read('<div role="link"><button data-testid="reply" aria-label="99 Replies">99</button></div>').replies, null);
  // "reposts" must never be read as replies.
  assert.equal(read('<div role="group" aria-label="7 reposts, 1 like"></div>').replies, null);
  assert.equal(read('<div role="group" aria-label="1 234 réponses, 10 000 vues"></div>', 'fr').replies, 1234);
});

test('default keep and highlight rules also need replies/views; each replies switch drops that condition', () => {
  const settings = normalizeSettings();
  const decide = (views, likes, bookmarks, replies, override = {}) => ({...core.getFilterDecision(views, 'x', {...settings, ...override}, {likes, bookmarks, replies})});
  // 1,000-view minimum; 500 views with 10 likes (2%), 3 bookmarks (0.6%).
  // Replies must reach 0.1% of views: 1 reply / 500 views = 0.2%.
  assert.deepEqual(decide(500, 10, 3, 1), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  // Exact keep boundary: with a 2,000-view minimum, 1 reply / 1,000 views = 0.1%.
  assert.deepEqual(decide(1000, 20, 5, 1, {xMinimumViews: 2000}), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  assert.deepEqual(decide(500, 10, 3, 0), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 10, 3, null), {reason: 'low-views', keptBy: null, bypassedReason: null});
  assert.deepEqual(decide(500, 10, 3, 0, {xHighReplyRatioEnabled: false}), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  assert.deepEqual(decide(500, 10, 3, 0, {xKeepReplyPercent: 0}), {reason: null, keptBy: 'high-engagement', bypassedReason: 'low-views'});
  // Highlight: bookmarks > 1%, likes > 2%, replies > 0.1% (all strict).
  const highlight = (likes, bookmarks, replies, override = {}) => core.shouldHighlightX(1000, {likes, bookmarks, replies}, {...settings, ...override});
  assert.equal(highlight(21, 11, 2), true);
  assert.equal(highlight(21, 11, 1), false);
  assert.equal(highlight(21, 11, null), false);
  assert.equal(highlight(21, 11, null, {xHighlightReplyRequired: false}), true);
});
