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

  function labeledCounts(text, locale) {
    if (!text) return [];
    return Array.from(text.matchAll(VIEW_COUNT_PATTERN), (match) => parseViewCount(match[0], { locale }));
  }

  function statusId(href) {
    return href?.match(/\/status\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
  }

  function getXViewCount(card, locale) {
    const ownTime = Array.from(card.querySelectorAll('a[href*="/status/"] time'))
      .find((time) => !isQuoteDescendant(time, card));
    const ownId = statusId(ownTime?.closest('a')?.getAttribute('href'));
    const analytics = Array.from(card.querySelectorAll('a[href*="/analytics"]')).filter((link) => {
      const href = link.getAttribute('href');
      return /\/status\/\d+\/analytics(?:[/?#]|$)/.test(href)
        && !isQuoteDescendant(link, card)
        && (!ownId || statusId(href) === ownId);
    });
    const counts = analytics.map((link) => {
      const labelCounts = labeledCounts(link.getAttribute('aria-label'), locale);
      if (labelCounts.length) return uniqueCount(labelCounts);
      return parseViewCount(link.textContent, { allowBare: true, locale });
    });
    if (counts.some((count) => count !== null)) return uniqueCount(counts);
    const groups = Array.from(card.querySelectorAll('[role="group"][aria-label]'))
      .filter((group) => !isQuoteDescendant(group, card));
    return uniqueCount(groups.flatMap((group) => labeledCounts(group.getAttribute('aria-label'), locale)));
  }

  function getYoutubeViewCount(card, locale) {
    const metadata = Array.from(card.querySelectorAll(YOUTUBE_METADATA_SELECTOR));
    const counts = metadata.flatMap((element) => {
      // Channel names share the same metadata class as counts on modern cards.
      if (element.closest(YOUTUBE_CHANNEL_SELECTOR)
          || element.querySelector(YOUTUBE_LINK_OR_CHANNEL_SELECTOR)) return [];
      const label = element.getAttribute('aria-label');
      if (label) {
        const labeled = parseViewCount(label, { locale });
        if (labeled !== null) return [labeled];
        // A known views label establishes meaning even if a spoken unit is new.
        if (/\s(?:views?|vues?)$/i.test(label)) {
          return [parseViewCount(element.textContent, { allowBare: true, locale })];
        }
      }
      // Metadata may join count and age with a bullet; titles are never scanned.
      return element.textContent.split(/[•·\n]/).map((part) => (
        /\s(?:views?|vues?)\s*$/i.test(part) ? parseViewCount(part, { locale }) : null
      ));
    });
    if (counts.some((count) => count !== null)) return uniqueCount(counts);

    const links = card.querySelectorAll(YOUTUBE_TITLE_LABEL_SELECTOR);
    const accessibleCounts = [];
    for (const link of links) {
      if (!/(?:\/watch\?|\/shorts\/)/.test(link.getAttribute('href') || '')) continue;
      const title = (link.getAttribute('title') || link.textContent).trim();
      const label = link.getAttribute('aria-label').trim();
      // Removing a verified title prefix prevents numbers in titles becoming views.
      if (!title || !label.startsWith(title)) continue;
      const matches = labeledCounts(label.slice(title.length), locale);
      if (matches.length === 1) accessibleCounts.push(matches[0]);
    }
    return uniqueCount(accessibleCounts);
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
    const profileIdentifiers = Array.from(card.querySelectorAll('[data-testid="User-Name"] a[href]'))
      .filter((link) => isOwnXAuthorMetadata(link, card))
      .map((link) => creatorIdentifierFromLink(link, 'x'));
    const statusIdentifiers = Array.from(card.querySelectorAll('a[href] time'))
      .filter((time) => isOwnXAuthorMetadata(time, card))
      .map((time) => creatorIdentifierFromLink(time.closest('a'), 'x', true));
    // Conflicting author metadata must not exempt an unrelated account's post.
    const identifiers = [...new Set([...profileIdentifiers, ...statusIdentifiers].filter(Boolean))];
    return identifiers.length === 1 ? identifiers : [];
  }

  function getYoutubeCreatorIdentifiers(card) {
    const containers = card.querySelectorAll(YOUTUBE_CREATOR_SOURCE_SELECTOR);
    const identifiers = [];
    // Nested containers (#byline-container > ytd-channel-name) share links.
    const visitedLinks = new Set();
    for (const container of containers) {
      const links = container.matches('a[href]') ? [container] : container.querySelectorAll('a[href]');
      for (const link of links) {
        if (visitedLinks.has(link)) continue;
        visitedLinks.add(link);
        if (link.closest(YOUTUBE_NON_AUTHOR_LINK_SELECTOR)) continue;
        const identifier = creatorIdentifierFromLink(link, 'youtube');
        if (identifier) identifiers.push(identifier);
      }
    }
    return [...new Set(identifiers)];
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

  const core = { parseViewCount, isSupportedPage, getCardSelector, getDecisionClassNames, getCards, getViewCount, getCreatorIdentifiers, getLinkCreatorIdentifier, getHideTarget };
  root.MinimumViewsCore = core;
  if (typeof module === 'object' && module.exports) module.exports = core;
})(typeof globalThis === 'object' ? globalThis : this);
