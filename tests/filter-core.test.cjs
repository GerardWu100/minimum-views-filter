const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const core = require('../src/filter-core.js');

function documentOf(html) {
  return new JSDOM(html).window.document;
}

function readFirst(html, site = 'youtube', locale = 'en') {
  const document = documentOf(html);
  return core.getViewCount(core.getCards(document, site)[0], site, locale);
}

test('browser global and CommonJS expose the same API', () => {
  assert.equal(globalThis.MinimumViewsCore, core);
});

test('counts preserve boundaries, zero, grouping and abbreviated precision', () => {
  for (const [text, expected] of [
    ['999 views', 999], ['1K', 1000], ['1.2K views', 1200],
    ['1,234 views', 1234], ['0 views', 0], ['No views', 0],
    ['1.25M views', 1_250_000], ['2B views', 2_000_000_000],
    ['63 thousand views', 63_000], ['1.2 million views', 1_200_000],
  ]) assert.equal(core.parseViewCount(text), expected, text);
  assert.equal(core.parseViewCount('999'), null);
  assert.equal(core.parseViewCount('999', { allowBare: true }), 999);
});

test('French formatting and region tags are explicit', () => {
  for (const [text, expected] of [
    ['1,2 k vues', 1200], ['1 234 vues', 1234], ['1\u202f234 vues', 1234],
    ['1\u00a0234 vues', 1234], ['Aucune vue', 0], ['0 vue', 0],
  ]) assert.equal(core.parseViewCount(text, { locale: 'fr-CA' }), expected, text);
  assert.equal(core.parseViewCount('1.2K views', { locale: 'fr' }), null);
  assert.equal(core.parseViewCount('1,234 views', { locale: 'fr' }), null);
  assert.equal(core.parseViewCount('1,2K views', { locale: 'en' }), null);
  assert.equal(core.parseViewCount('1K views', { locale: 'de' }), null);
});

test('malformed, unsafe, unrelated and ambiguous counts fail open', () => {
  for (const text of [
    '', 'views', '-10 views', '+10 views', '1.2 views', '12,34 views',
    '1 234 views', '1,23,456 views', '1.2.3K views', 'Infinity views',
    'NaN views', '9007199254740992 views', '1K likes', 'My 1K views challenge',
    '1K views 2 days ago', '1K views, 2K views', '1e3 views',
  ]) assert.equal(core.parseViewCount(text), null, text);
});

test('supported paths allow only X Home and YouTube Home/watch recommendations', () => {
  for (const path of ['/home', '/home/']) assert.equal(core.isSupportedPage('x', path), true);
  for (const path of ['/user/status/123', '/search', '/notifications', '/i/lists/1234', '/i/lists/123/members', '/user', '/explore', '/messages', '/']) {
    assert.equal(core.isSupportedPage('x', path), false);
  }
  for (const path of ['/', '/watch', '/watch/']) {
    assert.equal(core.isSupportedPage('youtube', path), true);
  }
  for (const path of ['/results', '/feed/subscriptions', '/feed/history', '/playlist', '/@creator', '/@creator/videos', '/channel/creator', '/shorts/123', '/shorts', '/embed/123', '/live/123', '/watch/other']) {
    assert.equal(core.isSupportedPage('youtube', path), false);
  }
  assert.equal(core.isSupportedPage('unknown', '/'), false);
});

test('X reads own analytics, ignoring tweet text and quote analytics', () => {
  const html = `<article data-testid="tweet">
    <a href="/author/status/123"><time>Today</time></a>
    <div data-testid="tweetText">This got 9M views!</div>
    <div role="link"><a href="/other/status/456"><time>Yesterday</time></a>
      <a href="/other/status/456/analytics" aria-label="9M views">9M</a></div>
    <a href="/author/status/123/analytics" aria-label="1,234 Views. View post analytics">1.2K</a>
    <button aria-label="10K likes">10K</button>
  </article>`;
  assert.equal(readFirst(html, 'x'), 1234);
});

test('X excludes explicitly marked quotes and status mismatches', () => {
  assert.equal(readFirst(`<article data-testid="tweet">
    <a href="/a/status/123"><time>Today</time></a>
    <div data-testid="quoteTweet"><a href="/b/status/456/analytics">5K</a></div>
    <a href="/b/status/456/analytics">8K</a>
  </article>`, 'x'), null);
});

test('X footer labels distinguish views from replies, likes, bookmarks and quotes', () => {
  assert.equal(readFirst(`<article data-testid="tweet">
    <div role="group" aria-label="3 replies, 5 reposts, 45 likes, 10 bookmarks, 1,002 views"></div>
  </article>`, 'x'), 1002);
  assert.equal(readFirst(`<article data-testid="tweet">
    <div role="link"><div role="group" aria-label="9M views"></div></div>
    <div role="group" aria-label="3 replies, 45 likes"></div>
    <p>1K views</p>
  </article>`, 'x'), null);
  assert.equal(readFirst(`<article data-testid="tweet"><a href="/a/status/123/analytics">0</a></article>`, 'x'), 0);
});

test('X nested tweet cards do not duplicate their outer card', () => {
  const document = documentOf(`<article data-testid="tweet" id="outer"><div role="link"><article data-testid="tweet" id="quote"></article></div></article>`);
  assert.deepEqual(core.getCards(document, 'x').map((card) => card.id), ['outer']);
});

test('X hides the timeline cell only when it holds precisely one article', () => {
  let document = documentOf(`<div data-testid="cellInnerDiv" id="cell"><article data-testid="tweet" id="tweet"></article></div>`);
  assert.equal(core.getHideTarget(document.getElementById('tweet'), 'x').id, 'cell');
  document = documentOf(`<div data-testid="cellInnerDiv"><article data-testid="tweet" id="tweet"></article><article data-testid="tweet"></article></div>`);
  assert.equal(core.getHideTarget(document.getElementById('tweet'), 'x').id, 'tweet');
});

test('YouTube outer cards eliminate nested lockups and avoid active Shorts players', () => {
  const document = documentOf(`<ytd-rich-item-renderer id="rich"><yt-lockup-view-model id="nested"><a href="/watch?v=video"></a></yt-lockup-view-model></ytd-rich-item-renderer>
    <ytd-compact-video-renderer id="recommendation"></ytd-compact-video-renderer>
    <ytd-shorts><yt-shorts-lockup-view-model id="playing"></yt-shorts-lockup-view-model></ytd-shorts>`);
  assert.deepEqual(core.getCards(document, 'youtube').map((card) => card.id), ['rich', 'recommendation']);
});

test('YouTube shelves retain independently filterable child cards', () => {
  const document = documentOf(`<ytd-rich-item-renderer id="shelf"><ytd-rich-section-renderer><ytd-reel-shelf-renderer>
    <yt-shorts-lockup-view-model id="first"></yt-shorts-lockup-view-model>
    <yt-shorts-lockup-view-model id="second"></yt-shorts-lockup-view-model>
  </ytd-reel-shelf-renderer></ytd-rich-section-renderer></ytd-rich-item-renderer>`);
  assert.deepEqual(core.getCards(document, 'youtube').map((card) => card.id), ['first', 'second']);
});

test('classic YouTube metadata excludes title digits and upload ages', () => {
  assert.equal(readFirst(`<ytd-video-renderer><a id="video-title">I got 100M views</a>
    <div id="metadata-line"><span>999 views</span><span>2 years ago</span></div>
  </ytd-video-renderer>`), 999);
  assert.equal(readFirst(`<ytd-video-renderer><a id="video-title">I got 100M views</a>
    <div id="metadata-line"><span>2 years ago</span><span>1K subscribers</span></div>
  </ytd-video-renderer>`), null);
});

test('live modern YouTube metadata uses the explicit aria-label', () => {
  for (const [text, label, expected] of [['6', '6 views', 6], ['838', '838 views', 838], ['63K', '63 thousand views', 63_000]]) {
    assert.equal(readFirst(`<ytd-rich-item-renderer><yt-lockup-view-model><a href="/watch?v=video"></a>
      <span class="ytContentMetadataViewModelMetadataText" aria-label="${label}">${text}</span>
    </yt-lockup-view-model></ytd-rich-item-renderer>`), expected);
  }
  assert.equal(readFirst(`<yt-lockup-view-model><a href="/watch?v=video"></a><span class="ytContentMetadataViewModelMetadataText">63K</span></yt-lockup-view-model>`), null);
});

test('YouTube Shorts metadata and French labels are supported without guessing absent counts', () => {
  assert.equal(readFirst(`<yt-shorts-lockup-view-model><div class="shortsLockupViewModelHostMetadataSubhead">1.2M views</div></yt-shorts-lockup-view-model>`), 1_200_000);
  assert.equal(readFirst(`<ytd-grid-video-renderer><div id="metadata-line"><span>1,2 k vues</span></div></ytd-grid-video-renderer>`, 'youtube', 'fr'), 1200);
  assert.equal(readFirst(`<ytd-reel-item-renderer><span id="view-count">No views</span></ytd-reel-item-renderer>`), 0);
});

test('YouTube accessible-title fallback removes the known title and rejects multiple counts', () => {
  assert.equal(readFirst(`<ytd-video-renderer><a id="video-title" href="/watch?v=1" title="My 100M views experiment" aria-label="My 100M views experiment by Author 3 days ago 1,234 views 5 minutes">My 100M views experiment</a></ytd-video-renderer>`), 1234);
  assert.equal(readFirst(`<ytd-video-renderer><a id="video-title" href="/watch?v=1" aria-label="My 100M views experiment">My 100M views experiment</a></ytd-video-renderer>`), null);
  assert.equal(readFirst(`<ytd-video-renderer><a id="video-title" href="/watch?v=1" aria-label="Title by 100 views 200 views">Title</a></ytd-video-renderer>`), null);
});

test('contradictory count metadata fails open', () => {
  assert.equal(readFirst(`<yt-lockup-view-model><a href="/watch?v=video"></a><span class="inline-metadata-item">10 views</span><span class="inline-metadata-item">20 views</span></yt-lockup-view-model>`), null);
});

test('other extensions may hide metadata without preventing reads or being modified', () => {
  for (const [site, html, expected] of [
    ['x', `<article data-testid="tweet"><a href="/a/status/123/analytics" hidden style="display:none" aria-label="4297 views. View post analytics">4.2K</a></article>`, 4297],
    ['youtube', `<ytd-video-renderer><div id="metadata-line" hidden style="display:none"><span>838 views</span></div></ytd-video-renderer>`, 838],
    ['youtube', `<yt-lockup-view-model><a href="/watch?v=video"></a><span class="ytContentMetadataViewModelMetadataText another-extension" style="visibility:hidden" aria-label="6 views">6</span></yt-lockup-view-model>`, 6],
  ]) {
    const document = documentOf(html);
    const before = document.documentElement.outerHTML;
    const cards = core.getCards(document, site);
    assert.equal(core.getViewCount(cards[0], site), expected);
    core.getHideTarget(cards[0], site);
    assert.equal(document.documentElement.outerHTML, before);
  }
});

test('metadata entirely removed by another extension remains unknown', () => {
  assert.equal(readFirst('<article data-testid="tweet"><div data-testid="tweetText">123 views</div></article>', 'x'), null);
  assert.equal(readFirst('<ytd-video-renderer><a id="video-title">123 views</a><div id="metadata-line"></div></ytd-video-renderer>'), null);
});

test('generic YouTube wrappers require video destinations and preserve other entities', () => {
  const document = documentOf(`<ytd-rich-item-renderer id="channel"><yt-lockup-view-model><a href="/@creator">Creator</a></yt-lockup-view-model></ytd-rich-item-renderer>
    <yt-lockup-view-model id="playlist"><a href="/playlist?list=collection">Playlist</a></yt-lockup-view-model>
    <yt-lockup-view-model id="playlist-preview"><a href="/watch?v=preview&list=collection">Preview</a><a class="ytLockupMetadataViewModelTitle" href="/playlist?list=collection">Playlist</a></yt-lockup-view-model>
    <yt-lockup-view-model id="ad"><a href="https://advertiser.example/">Advertisement</a></yt-lockup-view-model>
    <ytd-rich-item-renderer id="video-ad"><ytd-ad-slot-renderer><yt-lockup-view-model><a href="/watch?v=ad">Video advertisement</a></yt-lockup-view-model></ytd-ad-slot-renderer></ytd-rich-item-renderer>
    <ytd-rich-item-renderer id="game"><a href="/playables/game">Game</a></ytd-rich-item-renderer>
    <yt-lockup-view-model id="video"><a href="/watch?v=video">Video</a></yt-lockup-view-model>
    <ytd-rich-item-renderer id="short"><a href="/shorts/clip">Short</a></ytd-rich-item-renderer>
    <ytd-video-renderer id="classic"></ytd-video-renderer>`);
  assert.deepEqual(core.getCards(document, 'youtube').map((card) => card.id), ['video', 'short', 'classic']);
});

test('a channel named after a count cannot supply view metadata', () => {
  for (const channel of [
    '<span class="ytContentMetadataViewModelMetadataText"><a href="/@creator">10 views</a></span>',
    '<a href="/channel/creator"><span class="ytContentMetadataViewModelMetadataText">10 views</span></a>',
    '<ytd-channel-name><span class="inline-metadata-item">10 views</span></ytd-channel-name>',
  ]) {
    const wrapper = `<yt-lockup-view-model><a href="/watch?v=video">Video</a>${channel}`;
    assert.equal(readFirst(`${wrapper}</yt-lockup-view-model>`), null);
    assert.equal(readFirst(`${wrapper}<span class="ytContentMetadataViewModelMetadataText" hidden aria-label="6 views">6</span></yt-lockup-view-model>`), 6);
  }
});

function creatorIdentifiers(html, site) {
  return core.getCreatorIdentifiers(documentOf(html).body.firstElementChild, site);
}

test('X creator is the post author, excluding repost context, mentions and quoted authors', () => {
  const html = `<article data-testid="tweet">
    <div data-testid="socialContext"><a href="/reposter">Reposter</a></div>
    <div data-testid="User-Name"><a href="/NASA">NASA</a><a href="/NASA">@NASA</a>
      <a href="https://x.com/NASA/status/123"><time>Now</time></a></div>
    <div data-testid="tweetText"><a href="/mentioned">@mentioned</a>
      <a href="/mentioned/status/456"><time>Yesterday</time></a></div>
    <div role="link"><div data-testid="User-Name"><a href="/quoted">Quoted</a>
      <a href="/quoted/status/789"><time>Yesterday</time></a></div></div>
    <a href="/unrelated">Body link</a>
  </article>`;
  assert.deepEqual(creatorIdentifiers(html, 'x'), ['nasa']);
  for (const marker of ['data-testid="quoteTweet"', 'data-testid="quotedTweet"']) {
    assert.deepEqual(creatorIdentifiers(`<article data-testid="tweet"><div ${marker}>
      <div data-testid="User-Name"><a href="/quoted">Quoted</a></div>
      <a href="/quoted/status/123"><time>Now</time></a></div></article>`, 'x'), []);
  }
});

test('X own status permalink can establish identity but unrelated and ambiguous links cannot', () => {
  assert.deepEqual(creatorIdentifiers(`<article data-testid="tweet">
    <a href="https://twitter.com/Original/status/123"><time>Now</time></a>
    <a href="/other/status/456">Referenced post</a></article>`, 'x'), ['original']);
  assert.deepEqual(creatorIdentifiers(`<article data-testid="tweet">
    <div data-testid="User-Name"><a href="/first">First</a></div>
    <a href="/second/status/123"><time>Now</time></a></article>`, 'x'), []);
  assert.deepEqual(creatorIdentifiers(`<article data-testid="tweet">
    <div data-testid="socialContext"><a href="/reposter/status/123"><time>Now</time></a></div>
    <a href="/unrelated">Unrelated</a><span>@displayname</span></article>`, 'x'), []);
});

test('X external, malformed and reserved profile destinations never establish identity', () => {
  for (const href of [
    'https://evil.example/NASA', 'https://x.com.evil.example/NASA',
    'https://x.com@evil.example/NASA', 'https://attacker@x.com/NASA',
    'javascript:alert(1)', '/home', '/search', '/i', '/NASA/other', '/nasa%2Fother',
  ]) {
    assert.deepEqual(creatorIdentifiers(`<article data-testid="tweet">
      <div data-testid="User-Name"><a href="${href}">NASA</a></div></article>`, 'x'), [], href);
  }
});

test('classic YouTube author containers yield canonical handles and case-sensitive channel IDs', () => {
  const html = `<ytd-compact-video-renderer>
    <a id="video-title" href="/watch?v=video">Title</a>
    <ytd-channel-name><a href="https://www.youtube.com/@NASA">NASA</a></ytd-channel-name>
    <div id="byline-container"><a href="/channel/UCMixedCase_123">NASA</a></div>
    <div id="channel-name"><a href="/@nasa">NASA</a></div>
  </ytd-compact-video-renderer>`;
  assert.deepEqual(creatorIdentifiers(html, 'youtube'), ['@nasa', 'channel/UCMixedCase_123']);
  const identifiers = creatorIdentifiers(html, 'youtube');
  assert.equal(identifiers.includes('channel/UCMixedCase_123'), true);
  assert.equal(identifiers.includes('channel/ucmixedcase_123'), false);
});

test('modern YouTube author metadata supports both class forms and Unicode handle normalization', () => {
  for (const className of ['ytContentMetadataViewModelMetadataText', 'yt-content-metadata-view-model__metadata-text']) {
    assert.deepEqual(creatorIdentifiers(`<yt-lockup-view-model>
      <a class="ytLockupMetadataViewModelTitle" href="/watch?v=video">Title</a>
      <span class="${className}"><a href="/@E%CC%81COLE">École</a></span>
      <a class="${className}" href="/@%E6%95%99%E8%82%B2">教育</a>
      <span class="${className}">999 views</span></yt-lockup-view-model>`, 'youtube'), ['@école', '@教育']);
  }
});

test('YouTube ignores arbitrary links, display names, titles, descriptions and external destinations', () => {
  const html = `<yt-lockup-view-model>
    <a class="ytLockupMetadataViewModelTitle ytContentMetadataViewModelMetadataText" href="/@title">Title</a>
    <a id="video-title" href="/@secondtitle">Title</a>
    <a href="/@arbitrary">Unrelated</a>
    <div id="description-text"><span class="ytContentMetadataViewModelMetadataText"><a href="/@description">Description</a></span></div>
    <ytd-channel-name>NASA</ytd-channel-name>
    <span class="ytContentMetadataViewModelMetadataText">@NASA</span>
    <div id="byline-container">
      <a href="https://evil.example/@nasa">NASA</a>
      <a href="https://youtube.com.evil.example/@nasa">NASA</a>
      <a href="https://youtube.com@evil.example/@nasa">NASA</a>
      <a href="https://attacker@youtube.com/@nasa">NASA</a>
      <a href="/redirect?q=https://youtube.com/@nasa">NASA</a>
      <a href="/watch?v=video">NASA</a>
      <a href="/c/nasa">NASA</a><a href="/user/nasa">NASA</a>
      <a href="/@nasa/videos">NASA</a><a href="/@nasa%2Fvideos">NASA</a>
    </div></yt-lockup-view-model>`;
  assert.deepEqual(creatorIdentifiers(html, 'youtube'), []);
});

test('creator extraction handles absent metadata and leaves foreign DOM state intact', () => {
  assert.deepEqual(core.getCreatorIdentifiers(null, 'x'), []);
  assert.deepEqual(creatorIdentifiers('<article></article>', 'unknown'), []);
  assert.deepEqual(creatorIdentifiers('<article data-testid="tweet"></article>', 'x'), []);
  assert.deepEqual(creatorIdentifiers('<ytd-video-renderer></ytd-video-renderer>', 'youtube'), []);
  const card = documentOf(`<ytd-video-renderer><ytd-channel-name hidden class="foreign" style="display:none">
    <a href="/@NASA">NASA</a></ytd-channel-name></ytd-video-renderer>`).body.firstElementChild;
  const before = card.outerHTML;
  assert.deepEqual(core.getCreatorIdentifiers(card, 'youtube'), ['@nasa']);
  assert.equal(card.outerHTML, before);
});
