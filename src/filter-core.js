(function exposeMinimumViewsCore(root) {
  'use strict';

  // French YouTube abbreviates milliards (billions) as Md.
  const MULTIPLIERS = {
    k: 1_000, m: 1_000_000, b: 1_000_000_000, md: 1_000_000_000,
    thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
  };
  const YOUTUBE_CARD_SELECTOR = [
    'ytd-rich-item-renderer', 'ytd-rich-grid-media', 'ytd-video-renderer',
    'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
    'yt-lockup-view-model', 'ytd-reel-item-renderer',
    'yt-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model',
  ].join(',');
  const X_CARD_SELECTOR = 'article[data-testid="tweet"], article[role="article"]';
  // Quoted posts are nested interactive blocks; an inner article is also nested.
  const X_QUOTE_OR_CARD_SELECTOR = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"], ' + X_CARD_SELECTOR;
  const GENERIC_YOUTUBE_CARD_SELECTOR = 'ytd-rich-item-renderer, yt-lockup-view-model';
  const YOUTUBE_AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer';
  // Cards inside the Shorts player or an ad are never feed recommendations.
  const YOUTUBE_EXCLUDED_ANCESTOR_SELECTOR = 'ytd-shorts, ytd-reel-video-renderer, #shorts-player, ' + YOUTUBE_AD_SELECTOR;
  // Wrappers around ads or shelves are containers, not independent cards.
  const YOUTUBE_EXCLUDED_DESCENDANT_SELECTOR = 'ytd-rich-section-renderer, ytd-reel-shelf-renderer, ' + YOUTUBE_AD_SELECTOR;
  const YOUTUBE_CREATOR_CONTAINER_SELECTOR = 'ytd-channel-name, #channel-name, #byline-container';
  const YOUTUBE_CHANNEL_SELECTOR = [
    YOUTUBE_CREATOR_CONTAINER_SELECTOR,
    'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href^="/user/"]',
    'a[href^="/c/"]',
  ].join(',');
  // Every a[href^=...] in YOUTUBE_CHANNEL_SELECTOR is also an a[href].
  const YOUTUBE_LINK_OR_CHANNEL_SELECTOR = 'a[href], ' + YOUTUBE_CREATOR_CONTAINER_SELECTOR;
  const YOUTUBE_TITLE_LINK_SELECTORS = [
    'a#video-title', 'a#video-title-link',
    'a.ytLockupMetadataViewModelTitle', 'a.yt-lockup-metadata-view-model__title',
  ];
  const YOUTUBE_TITLE_HREF_SELECTOR = YOUTUBE_TITLE_LINK_SELECTORS.map((selector) => selector + '[href]').join(',');
  const YOUTUBE_TITLE_LABEL_SELECTOR = YOUTUBE_TITLE_LINK_SELECTORS.map((selector) => selector + '[aria-label]').join(',');
  const YOUTUBE_METADATA_SELECTOR = [
    '#metadata-line > span', '.inline-metadata-item',
    '.yt-content-metadata-view-model__metadata-text',
    '.ytContentMetadataViewModelMetadataText',
    '.shortsLockupViewModelHostMetadataSubhead',
    '.yt-shorts-lockup-view-model__metadata-subhead',
    '#view-count',
  ].join(',');
  const YOUTUBE_CREATOR_SOURCE_SELECTOR = [
    YOUTUBE_CREATOR_CONTAINER_SELECTOR,
    '.yt-content-metadata-view-model__metadata-text',
    '.ytContentMetadataViewModelMetadataText',
  ].join(',');
  // Title and description links can name other channels than the author.
  const YOUTUBE_NON_AUTHOR_LINK_SELECTOR = [
    '#video-title', '#video-title-link', '.ytLockupMetadataViewModelTitle',
    '.yt-lockup-metadata-view-model__title', '#description', '#description-text',
    '.yt-lockup-metadata-view-model__description',
  ].join(',');
  const PROFILE_HOST_PATTERNS = {
    x: /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/,
    youtube: /^(?:(?:www|m)\.)?youtube\.com$/,
  };
  // Every class the YouTube adapter's selectors name. A class change elsewhere
  // (hover, focus, theme) cannot alter a count, creator or card decision.
  const YOUTUBE_DECISION_CLASS_NAMES = [
    'inline-metadata-item', 'yt-content-metadata-view-model__metadata-text',
    'ytContentMetadataViewModelMetadataText', 'shortsLockupViewModelHostMetadataSubhead',
    'yt-shorts-lockup-view-model__metadata-subhead', 'ytLockupMetadataViewModelTitle',
    'yt-lockup-metadata-view-model__title', 'yt-lockup-metadata-view-model__description',
  ];
  const VIEW_WORD = '(?:views?|vues?)';
  const COUNT_TOKEN = '(?:no|aucune|[0-9][0-9.,\\s\\u00a0\\u202f]*(?:md|[kmb]|thousand|million|billion)?)';

  // French writes "1,2 M de vues"; the parser accepts "de" only for French units.
  const VIEW_COUNT_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}.,+\\-])(${COUNT_TOKEN})\\s+(?:de\\s+)?${VIEW_WORD}(?![\\p{L}])`, 'giu');
  const ENGAGEMENT_WORDS = {
    likes: '(?:likes?|mentions? j[’\u0027]aime|j[’\u0027]aime)',
    bookmarks: '(?:bookmarks?|signets?|enregistrements?)',
  };
  const ENGAGEMENT_SELECTORS = {
    likes: '[data-testid="like"], [data-testid="unlike"]',
    bookmarks: '[data-testid="bookmark"], [data-testid="removeBookmark"]',
  };
  const ENGAGEMENT_METRICS = Object.keys(ENGAGEMENT_SELECTORS);
  const ENGAGEMENT_GROUP_SELECTOR = '[role="group"][aria-label]';
  const ENGAGEMENT_SOURCE_SELECTOR = [ENGAGEMENT_GROUP_SELECTOR, ...Object.values(ENGAGEMENT_SELECTORS)].join(',');
  const ENGAGEMENT_PATTERNS = Object.fromEntries(ENGAGEMENT_METRICS.map((metric) => [metric,
    new RegExp(`(?<![\\p{L}\\p{N}.,+\\-])(${COUNT_TOKEN}|aucun)\\s+(?:de\\s+)?${ENGAGEMENT_WORDS[metric]}(?![\\p{L}])`, 'giu'),
  ]));
  const PERCENT_SCALE = 100;
  const RATIO_COMPARISON_EPSILON = 2 * Number.EPSILON;
  const HISTORY_TITLE_LENGTH = 240;
  // Lazily resolved: the browser fixture loads this file before settings.js.
  let settingsApi = null;

  /**
   * Parse a displayed English or French view count without guessing separators.
   *
   * @param {string} text Displayed count, optionally ending in views or vues.
   * @param {object} [options] Parsing options.
   * @param {boolean} [options.allowBare=false] Accept an unsuffixed number when
   *   its DOM location already establishes that it represents views.
   * @param {string} [options.locale='en'] English or French locale, including
   *   regional tags. Other locales return null rather than assume formatting.
   * @returns {number|null} Nonnegative count, or null for unknown/ambiguous text.
   *   Abbreviated counts retain the precision of the displayed approximation.
   */
  function parseViewCount(text, { allowBare = false, locale = 'en' } = {}) {
    if (typeof text !== 'string') return null;
    const language = String(locale).toLowerCase().split(/[-_]/)[0];
    if (language !== 'en' && language !== 'fr') return null;
    let value = text.trim().replace(/[\u00a0\u202f]/g, ' ');
    if (/^(?:no views?|aucune vue)$/i.test(value)) return 0;
    const label = value.match(/\s+(de\s+)?(?:views?|vues?)$/i);
    if (label) value = value.slice(0, label.index).trim();
    const unit = value.match(/\s*(thousand|million|billion|md|[kmb])$/i);
    const unitName = unit?.[1].toLowerCase();
    // Spelled-out units are English; Md (milliard) and "de" are French.
    if (unitName === 'md' ? language !== 'fr' : unitName?.length > 1 && language !== 'en') return null;
    if (label?.[1] && (language !== 'fr' || !unit)) return null;
    if (!label && !unit && !allowBare) return null;
    if (unit) value = value.slice(0, unit.index).trim();

    // Count labels are whole counts; only abbreviated counts permit decimals.
    const integerPattern = language === 'en'
      ? /^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)$/
      : /^(?:\d+|[1-9]\d{0,2}(?: \d{3})+)$/;
    const decimalPattern = language === 'en' ? /^\d+\.\d+$/ : /^\d+,\d+$/;
    if (!integerPattern.test(value) && !(unit && decimalPattern.test(value))) return null;
    const normalized = language === 'en'
      ? value.replace(/,/g, '')
      : value.replace(/ /g, '').replace(',', '.');
    // Round away binary float error, e.g. 4.1 * 1e6 = 4099999.9999999995.
    const count = unit ? Math.round(Number(normalized) * MULTIPLIERS[unitName]) : Number(normalized);
    return Number.isFinite(count) && count >= 0 && count <= Number.MAX_SAFE_INTEGER
      ? count : null;
  }

  /**
   * Check whether a pathname is inside the supported filtering surface.
   *
   * @param {'x'|'youtube'} site Adapter name.
   * @param {string} pathname URL pathname without query or fragment.
   * @returns {boolean} True only for X Home or YouTube Home/watch pages.
   *   On watch pages, card selection covers recommendations, not the active player.
   */
  function isSupportedPage(site, pathname) {
    if (typeof pathname !== 'string') return false;
    if (site === 'x') return /^\/home\/?$/.test(pathname);
    if (site === 'youtube') return pathname === '/' || /^\/watch\/?$/.test(pathname);
    return false;
  }

  /** Return the raw card selector used to route mutations to their owning card. */
  function getCardSelector(site) {
    return site === 'x' ? X_CARD_SELECTOR : site === 'youtube' ? YOUTUBE_CARD_SELECTOR : null;
  }

  /**
   * List class names whose presence can change the adapter's decision.
   *
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {string[]} Class tokens named by the adapter's selectors. X reads no
   *   classes, so it returns an empty array.
   */
  function getDecisionClassNames(site) {
    return site === 'youtube' ? [...YOUTUBE_DECISION_CLASS_NAMES] : [];
  }

  /**
   * Find independently hideable cards, choosing outer wrappers over nested cards.
   *
   * @param {Document|Element} document DOM root to inspect.
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {Element[]} Non-overlapping cards in DOM order. Shelves and active
   *   short-form player elements are excluded; recommendations remain eligible.
   */
  function getCards(document, site) {
    const selector = getCardSelector(site);
    if (!selector || !document?.querySelectorAll) return [];
    const matches = Array.from(document.querySelectorAll(selector));
    if (document.matches?.(selector)) matches.unshift(document);
    // Matches are in document order, so an accepted ancestor always precedes
    // its descendants and is the most recently accepted card; nested matches
    // are skipped before their own filters run.
    const cards = [];
    for (const card of matches) {
      if (cards.at(-1)?.contains(card)) continue;
      if (isIndependentCard(card, site)) cards.push(card);
    }
    return cards;
  }

  function isIndependentCard(card, site) {
    if (site === 'x') return !isQuoteDescendant(card, null);
    return !card.closest(YOUTUBE_EXCLUDED_ANCESTOR_SELECTOR)
      && !card.querySelector(YOUTUBE_EXCLUDED_DESCENDANT_SELECTOR)
      && (!card.matches(GENERIC_YOUTUBE_CARD_SELECTOR) || hasVideoDestination(card));
  }

  function hasVideoDestination(card) {
    const titleLinks = card.querySelectorAll(YOUTUBE_TITLE_HREF_SELECTOR);
    const links = titleLinks.length ? titleLinks : card.querySelectorAll('a[href]');
    return Array.from(links).some((link) => {
      const href = link.getAttribute('href');
      // Generic lockups also render channels, playlists, games, and promotions.
      return (/^(?:https?:\/\/(?:www\.)?youtube\.com)?\/watch\?/.test(href)
        && /[?&]v=[^&#]+/.test(href))
        || /^(?:https?:\/\/(?:www\.)?youtube\.com)?\/shorts\/[^/?#]+/.test(href);
    });
  }

  // True when a quote block or nested card lies strictly between element and
  // card (or anywhere above element when card is null).
  function isQuoteDescendant(element, card) {
    const nearest = element.parentElement?.closest(X_QUOTE_OR_CARD_SELECTOR);
    return !!nearest && (!card || (nearest !== card && card.contains(nearest)));
  }

  function uniqueCount(counts) {
    const knownCounts = [...new Set(counts.filter((count) => count !== null))];
    return knownCounts.length === 1 ? knownCounts[0] : null;
  }

  function viewCountCandidates(text, locale) {
    return Array.from((text || '').matchAll(VIEW_COUNT_PATTERN), (match) => ({
      count: parseViewCount(match[0], {locale}), rounded: /[a-z]/i.test(match[1].replace(/^(?:no|aucune)$/i, '0')),
    })).filter(({count}) => count !== null);
  }

  /** Exact accessible counts take precedence; disagreements remain unknown. */
  function preferredCount(accessible, visible) {
    const exact = accessible.filter(({rounded}) => !rounded);
    const candidates = exact.length ? exact : accessible.length ? accessible : visible;
    return uniqueCount(candidates.map(({count}) => count));
  }

  function statusId(href) {
    return href?.match(/\/status\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
  }

  function getXViewCount(card, locale) {
    const ownTime = Array.from(card.querySelectorAll('a[href*="/status/"] time'))
      .find((time) => isOwnXAuthorMetadata(time, card));
    const ownId = statusId(ownTime?.closest('a')?.getAttribute('href'));
    const analytics = Array.from(card.querySelectorAll('a[href*="/analytics"]')).filter((link) => {
      const href = link.getAttribute('href');
      return /\/status\/\d+\/analytics(?:[/?#]|$)/.test(href)
        && isOwnXAuthorMetadata(link, card)
        && (!ownId || statusId(href) === ownId);
    });
    const accessible = analytics.flatMap((link) => viewCountCandidates(link.getAttribute('aria-label'), locale));
    const groups = Array.from(card.querySelectorAll('[role="group"][aria-label]'))
      .filter((group) => isOwnXAuthorMetadata(group, card));
    for (const group of groups) accessible.push(...viewCountCandidates(group.getAttribute('aria-label'), locale));
    const visible = accessible.length ? [] : analytics.map((link) => ({count: parseViewCount(link.textContent, {allowBare: true, locale})}));
    return preferredCount(accessible, visible);
  }

  function getYoutubeViewCount(card, locale) {
    const accessible = [];
    const visible = [];
    for (const element of card.querySelectorAll(YOUTUBE_METADATA_SELECTOR)) {
      // Channel names share metadata classes, but cannot supply view counts.
      if (element.closest(YOUTUBE_CHANNEL_SELECTOR)
          || element.querySelector(YOUTUBE_LINK_OR_CHANNEL_SELECTOR)) continue;
      const label = element.getAttribute('aria-label');
      if (label && parseViewCount(label, {locale}) !== null) {
        accessible.push(...viewCountCandidates(label, locale));
      } else if (label && /\s(?:views?|vues?)$/i.test(label)) {
        visible.push({count: parseViewCount(element.textContent, {allowBare: true, locale})});
      } else {
        for (const part of element.textContent.split(/[•·\n]/)) {
          if (/\s(?:views?|vues?)\s*$/i.test(part)) visible.push({count: parseViewCount(part, {locale})});
        }
      }
    }
    for (const link of card.querySelectorAll(YOUTUBE_TITLE_LABEL_SELECTOR)) {
      if (!/(?:\/watch\?|\/shorts\/)/.test(link.getAttribute('href') || '')) continue;
      const title = (link.getAttribute('title') || link.textContent).trim();
      const label = link.getAttribute('aria-label').trim();
      // Only the suffix after a verified title can supply a count.
      if (!title || !label.startsWith(title)) continue;
      const matches = viewCountCandidates(label.slice(title.length), locale);
      if (matches.length === 1) accessible.push(matches[0]);
    }
    return preferredCount(accessible, visible);
  }

  /**
   * Read the view count from adapter-specific, semantically bounded metadata.
   *
   * @param {Element} card One card returned by getCards.
   * @param {'x'|'youtube'} site Adapter name.
   * @param {string} [locale='en'] Locale used by the site, not the user's machine.
   * @returns {number|null} Displayed count, or null if absent or contradictory.
   *   Tweet bodies, quoted tweets, titles, likes and replies are never count sources.
   */
  function getViewCount(card, site, locale = 'en') {
    if (!card?.querySelectorAll) return null;
    if (site === 'x') return getXViewCount(card, locale);
    if (site === 'youtube') return getYoutubeViewCount(card, locale);
    return null;
  }

  /** Read labeled engagement counts, retaining whether the source is rounded. */
  function engagementCounts(text, metric, locale) {
    if (!text) return [];
    return Array.from(text.matchAll(ENGAGEMENT_PATTERNS[metric]), (match) => {
      const token = /^(?:no|aucune?)$/i.test(match[1]) ? '0' : match[1];
      return {count: parseViewCount(token, {allowBare: true, locale}), rounded: /[a-z]/i.test(token)};
    }).filter(({count}) => count !== null);
  }

  /**
   * Read an X card's own likes and bookmark counts without clicking or fetching.
   *
   * Parameters
   * ----------
   * card : Element
   *     Outer X post card; quote, body, and repost-context subtrees are excluded.
   * locale : string
   *     Page language; only English and French number formats are supported.
   *
   * Returns
   * -------
   * {likes: number|null, bookmarks: number|null}
   *     Exact accessibility labels outrank rounded labels and visible counters.
   *     Contradictory counts and missing counters return null, never implicit zero.
   */
  function getXEngagement(card, locale = 'en') {
    const result = {likes: null, bookmarks: null};
    const labels = {likes: [], bookmarks: []};
    const buttons = {likes: [], bookmarks: []};
    // Collect both metrics in one subtree query and check ownership once per
    // source; group labels still supply both independent count candidates.
    for (const element of card.querySelectorAll(ENGAGEMENT_SOURCE_SELECTOR)) {
      if (!isOwnXAuthorMetadata(element, card)) continue;
      const isGroup = element.matches(ENGAGEMENT_GROUP_SELECTOR);
      const testId = element.getAttribute('data-testid');
      const buttonMetric = testId === 'like' || testId === 'unlike' ? 'likes'
        : testId === 'bookmark' || testId === 'removeBookmark' ? 'bookmarks' : null;
      if (buttonMetric) buttons[buttonMetric].push(element);
      const label = element.getAttribute('aria-label');
      if (!label) continue;
      for (const metric of ENGAGEMENT_METRICS) {
        if (isGroup || buttonMetric === metric) labels[metric].push(...engagementCounts(label, metric, locale));
      }
    }
    for (const metric of ENGAGEMENT_METRICS) {
      if (labels[metric].length) {
        const exact = labels[metric].filter(({rounded}) => !rounded);
        result[metric] = uniqueCount((exact.length ? exact : labels[metric]).map(({count}) => count));
      } else {
        result[metric] = uniqueCount(buttons[metric].map((button) => parseViewCount(button.textContent, {allowBare: true, locale})));
      }
    }
    return result;
  }

  /**
   * Decide whether counts fail the configured view or X engagement rules, and
   * whether an X high-engagement exception kept a card that would be hidden.
   *
   * Parameters
   * ----------
   * views : number|null
   *     Displayed view count; null means unknown, zero is known but has no ratio.
   * site : "x" | "youtube"
   *     Site whose independent view minimum applies.
   * settings : object
   *     Normalized settings. Percent thresholds are in percentage points.
   * engagement : {likes: number|null, bookmarks: number|null}
   *     Own X metrics; missing values cannot hide or rescue through ratios.
   *
   * Returns
   * -------
   * {reason: string|null, keptBy: string|null, bypassedReason: string|null}
   *     reason is low-views, low-like-ratio, unknown-views, or null to keep the
   *     card. The keep exception requires EVERY enabled keep rule to pass
   *     (user request 2026-09-29): with both on, likes/views AND
   *     bookmarks/views must reach their thresholds. keptBy names the rules
   *     that applied (high-like-and-bookmark-ratio, high-like-ratio, or
   *     high-bookmark-ratio) only when the exception overrode bypassedReason
   *     (low-like-ratio or low-views); a card that passes anyway has keptBy
   *     null. Whitelist exemptions are applied by the caller. No history is
   *     consulted for this decision.
   */
  function getFilterDecision(views, site, settings, engagement = {likes: null, bookmarks: null}) {
    const kept = {reason: null, keptBy: null, bypassedReason: null};
    if (views === null) return settings.hideUnknown ? {...kept, reason: 'unknown-views'} : kept;
    const belowMinimum = settings[site + 'MinimumViewsEnabled'] && views < settings[site + 'MinimumViews'];
    if (site !== 'x' || views === 0) return belowMinimum ? {...kept, reason: 'low-views'} : kept;
    // For count c, views v, percent p: c/v >= p/100 iff 100*c >= p*v.
    // A two-operation machine-precision allowance preserves decimal boundaries
    // such as 7/10000 = 0.07%, whose binary product is slightly above 700.
    const reaches = (count, percent) => {
      if (count === null) return false;
      const actual = count * PERCENT_SCALE;
      const required = percent * views;
      return actual >= required || required - actual <= RATIO_COMPARISON_EPSILON * Math.max(actual, required);
    };
    const lowReason = settings.xLowLikeRatioEnabled && engagement.likes !== null
      && !reaches(engagement.likes, settings.xMinimumLikePercent) ? 'low-like-ratio'
      : belowMinimum ? 'low-views' : null;
    // Each enabled keep rule is a required condition; unknown counts fail it.
    const likeRule = settings.xHighLikeRatioEnabled;
    const bookmarkRule = settings.xHighBookmarkRatioEnabled;
    const keeps = (likeRule || bookmarkRule)
      && (!likeRule || reaches(engagement.likes, settings.xKeepLikePercent))
      && (!bookmarkRule || reaches(engagement.bookmarks, settings.xKeepBookmarkPercent));
    const keptBy = !keeps ? null
      : likeRule && bookmarkRule ? 'high-like-and-bookmark-ratio'
        : likeRule ? 'high-like-ratio' : 'high-bookmark-ratio';
    if (keptBy) return lowReason ? {reason: null, keptBy, bypassedReason: lowReason} : kept;
    return {...kept, reason: lowReason};
  }

  /** Return only the hide reason from getFilterDecision, or null to keep the card. */
  function getFilterReason(views, site, settings, engagement) {
    return getFilterDecision(views, site, settings, engagement).reason;
  }

  /**
   * Test the independent X highlight thresholds.
   *
   * Parameters
   * ----------
   * views : number|null
   *     Current own-post views; only positive known counts can form a ratio.
   * engagement : {likes: number|null, bookmarks: number|null}
   *     Current own-post counts; missing counts remain unknown.
   * settings : object
   *     Normalized settings. xHighlightBookmarkPercent and xHighlightLikePercent
   *     are in percent units; xHighlightLikeRequired adds the likes condition.
   *
   * Returns
   * -------
   * boolean
   *     True only when enabled, bookmarks/views is strictly above its
   *     threshold, AND (when required) likes/views is strictly above its
   *     threshold. Unknown likes cannot satisfy a required likes condition.
   *     The caller limits this presentation to visible X Home cards.
   */
  function shouldHighlightX(views, engagement, settings) {
    if (!settings.xBookmarkHighlightEnabled || !(views > 0)) return false;
    // For count c, views v and percent p: c/v > p/100 iff 100*c > p*v.
    // Treat floating-point rounding at equality as equality, not as a highlight.
    const exceeds = (count, percent) => {
      if (count === null) return false;
      const actual = count * PERCENT_SCALE;
      const required = percent * views;
      return actual - required > RATIO_COMPARISON_EPSILON * Math.max(actual, required);
    };
    return exceeds(engagement.bookmarks, settings.xHighlightBookmarkPercent)
      && (!settings.xHighlightLikeRequired || exceeds(engagement.likes, settings.xHighlightLikePercent));
  }

  /**
   * Extract a canonical item link and short title for local filtered-item history.
   *
   * Parameters
   * ----------
   * card : Element
   *     Recognized outer card. X quote/body links cannot identify its post.
   * site : "x" | "youtube"
   *     Selects post permalinks or video-title links.
   *
   * Returns
   * -------
   * {url: string|null, title: string}
   *     HTTPS permalink without tracking parameters, plus at most 240 characters.
   *     Missing/ambiguous destinations produce null; no identity is fetched.
   */
  function getItemMetadata(card, site) {
    let links;
    let title = '';
    if (site === 'x') {
      links = Array.from(card.querySelectorAll('a[href] time'))
        .filter((time) => isOwnXAuthorMetadata(time, card)).map((time) => time.closest('a'));
      if (!links.length) links = Array.from(card.querySelectorAll('a[href*="/analytics"]'))
        .filter((link) => isOwnXAuthorMetadata(link, card));
      title = Array.from(card.querySelectorAll('[data-testid="tweetText"]'))
        .find((element) => !isQuoteDescendant(element, card))?.textContent || 'X post';
    } else {
      links = Array.from(card.querySelectorAll(YOUTUBE_TITLE_HREF_SELECTOR));
      if (!links.length) links = Array.from(card.querySelectorAll('a[href]')).filter((link) => (
        // A thumbnail may retain the own permalink after the title loses it,
        // but descriptions and creator metadata can link to unrelated videos.
        !link.closest(YOUTUBE_NON_AUTHOR_LINK_SELECTOR + ',' + YOUTUBE_CREATOR_SOURCE_SELECTOR)
      ));
      title = card.querySelector(YOUTUBE_TITLE_LINK_SELECTORS.join(','))?.textContent || 'YouTube video';
    }
    const destinations = new Set();
    for (const link of links) {
      try {
        const url = new URL(link.getAttribute('href'), site === 'x' ? 'https://x.com' : 'https://www.youtube.com');
        if (!PROFILE_HOST_PATTERNS[site].test(url.hostname) || !/^https?:$/.test(url.protocol)
            || url.username || url.password || url.port) continue;
        if (site === 'x') {
          const match = url.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d+)(?:\/analytics)?\/?$/i);
          if (match) destinations.add('https://x.com/' + match[1].toLowerCase() + '/status/' + match[2]);
        } else {
          const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/shorts\/([a-z0-9_-]+)\/?$/i)?.[1];
          if (videoId && /^[a-z0-9_-]+$/i.test(videoId)) destinations.add('https://www.youtube.com/watch?v=' + videoId);
        }
      } catch { /* Invalid page links cannot become history destinations. */ }
    }
    return {url: destinations.size === 1 ? [...destinations][0] : null, title: title.replace(/\s+/g, ' ').trim().slice(0, HISTORY_TITLE_LENGTH)};
  }

  // Only profile destinations in author metadata can establish creator identity.
  function creatorIdentifierFromLink(link, site, allowStatus = false) {
    const href = link.getAttribute('href');
    if (!href || !/^(?:https?:\/\/|\/)/i.test(href)) return null;
    let pathname;
    try {
      const url = new URL(href, site === 'x' ? 'https://x.com' : 'https://www.youtube.com');
      if (!PROFILE_HOST_PATTERNS[site].test(url.hostname) || !/^https?:$/.test(url.protocol)
          || url.username || url.password || url.port) return null;
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    const match = site === 'x'
      ? pathname.match(allowStatus ? /^\/([^/]+)\/status\/\d+\/?$/ : /^\/([^/]+)\/?$/)
      : pathname.match(/^\/(@[^/]+|channel\/[^/]+)\/?$/);
    if (!match) return null;
    // Resolve the shared validator in both browser and CommonJS environments.
    settingsApi ??= root.MinimumViewsSettings || (
      typeof module === 'object' && module.exports ? require('./settings.js') : null
    );
    return settingsApi?.normalizeAccountIdentifier?.(match[1], site) || null;
  }

  function isOwnXAuthorMetadata(element, card) {
    return !isQuoteDescendant(element, card)
      && !element.closest('[data-testid="tweetText"], [data-testid="socialContext"]');
  }

  function getXCreatorIdentifiers(card) {
    let author = null;
    for (const link of card.querySelectorAll('[data-testid="User-Name"] a[href]')) {
      if (!isOwnXAuthorMetadata(link, card)) continue;
      const identifier = creatorIdentifierFromLink(link, 'x');
      if (!identifier) continue;
      // Two distinct authors make this card ambiguous; later links cannot fix it.
      if (author !== null && author !== identifier) return [];
      author = identifier;
    }
    // A valid profile still needs checking against the post's own permalink.
    for (const time of card.querySelectorAll('a[href] time')) {
      if (!isOwnXAuthorMetadata(time, card)) continue;
      const identifier = creatorIdentifierFromLink(time.closest('a'), 'x', true);
      if (!identifier) continue;
      if (author !== null && author !== identifier) return [];
      author = identifier;
    }
    return author === null ? [] : [author];
  }

  function getYoutubeCreatorIdentifiers(card) {
    const containers = card.querySelectorAll(YOUTUBE_CREATOR_SOURCE_SELECTOR);
    const identifiers = new Set();
    let scannedContainer = null;
    for (const container of containers) {
      // Containers arrive in DOM order. An outer source already supplied every
      // link under its nested sources, so avoid repeating their subtree scans.
      if (scannedContainer?.contains(container)) continue;
      const isLink = container.matches('a[href]');
      const links = isLink ? [container] : container.querySelectorAll('a[href]');
      // An anchor source supplies only itself, not any nested author sources.
      if (!isLink) scannedContainer = container;
      for (const link of links) {
        if (link.closest(YOUTUBE_NON_AUTHOR_LINK_SELECTOR)) continue;
        const identifier = creatorIdentifierFromLink(link, 'youtube');
        if (identifier) identifiers.add(identifier);
      }
    }
    return [...identifiers];
  }

  /**
   * Read stable creator identifiers from the displayed card's author metadata.
   *
   * @param {Element} card One card returned by getCards.
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {string[]} Unique identifiers accepted by the settings normalizer:
   *   lowercase X handles without @, NFC/lowercase YouTube @handles, or
   *   case-preserved YouTube channel/IDs. Missing or ambiguous X authors return
   *   an empty array. Display names, quoted authors and arbitrary links are not
   *   identity sources. No handle/channel-ID equivalence is inferred.
   */
  function getCreatorIdentifiers(card, site) {
    if (!card?.querySelectorAll) return [];
    if (site === 'x') return getXCreatorIdentifiers(card);
    if (site === 'youtube') return getYoutubeCreatorIdentifiers(card);
    return [];
  }

  /**
   * Read the creator a profile or channel link points to.
   *
   * @param {Element} link Anchor the user chose outside any recognized card,
   *   such as the channel link below a YouTube player.
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {string|null} Normalized identifier for a profile/channel link, or
   *   null for posts, videos, other hosts, and unsupported paths.
   */
  function getLinkCreatorIdentifier(link, site) {
    return link?.getAttribute ? creatorIdentifierFromLink(link, site) : null;
  }

  /**
   * Select a safe outer wrapper whose removal will not hide another tweet.
   *
   * @param {Element} card One card returned by getCards.
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {Element} X's timeline cell only when it contains exactly this one
   *   article/tweet; otherwise the original card. YouTube cards are already outer.
   */
  function getHideTarget(card, site) {
    if (site !== 'x') return card;
    const cell = card.closest('[data-testid="cellInnerDiv"]');
    if (!cell) return card;
    const articles = cell.querySelectorAll('article, [data-testid="tweet"]');
    return articles.length === 1 && articles[0] === card ? cell : card;
  }

  const core = { parseViewCount, isSupportedPage, getCardSelector, getDecisionClassNames, getCards, getViewCount, getXEngagement, getFilterDecision, getFilterReason, shouldHighlightX, getItemMetadata, getCreatorIdentifiers, getLinkCreatorIdentifier, getHideTarget };
  root.MinimumViewsCore = core;
  if (typeof module === 'object' && module.exports) module.exports = core;
})(typeof globalThis === 'object' ? globalThis : this);
