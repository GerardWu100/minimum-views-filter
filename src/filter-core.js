(function exposeMinimumViewsCore(root) {
  'use strict';

  const MULTIPLIERS = {
    k: 1_000, m: 1_000_000, b: 1_000_000_000,
    thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
  };
  const YOUTUBE_CARD_SELECTOR = [
    'ytd-rich-item-renderer', 'ytd-rich-grid-media', 'ytd-video-renderer',
    'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
    'yt-lockup-view-model', 'ytd-reel-item-renderer',
    'yt-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model',
  ].join(',');
  const X_CARD_SELECTOR = 'article[data-testid="tweet"], article[role="article"]';
  const GENERIC_YOUTUBE_CARD_SELECTOR = 'ytd-rich-item-renderer, yt-lockup-view-model';
  const YOUTUBE_AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer';
  const YOUTUBE_CHANNEL_SELECTOR = [
    'ytd-channel-name', '#channel-name', '#byline-container',
    'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href^="/user/"]',
    'a[href^="/c/"]',
  ].join(',');
  const VIEW_WORD = '(?:views?|vues?)';
  const COUNT_TOKEN = '(?:no|aucune|[0-9][0-9.,\\s\\u00a0\\u202f]*(?:[kmb]|thousand|million|billion)?)';

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
    const label = value.match(/\s+(?:views?|vues?)$/i);
    if (label) value = value.slice(0, label.index).trim();
    const unit = value.match(/\s*(thousand|million|billion|[kmb])$/i);
    if (unit && unit[1].length > 1 && language !== 'en') return null;
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
    const count = Number(normalized) * (unit ? MULTIPLIERS[unit[1].toLowerCase()] : 1);
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

  /**
   * Find independently hideable cards, choosing outer wrappers over nested cards.
   *
   * @param {Document|Element} document DOM root to inspect.
   * @param {'x'|'youtube'} site Adapter name.
   * @returns {Element[]} Non-overlapping cards in DOM order. Shelves and active
   *   short-form player elements are excluded; recommendations remain eligible.
   */
  function getCards(document, site) {
    const selector = site === 'x' ? X_CARD_SELECTOR : site === 'youtube' ? YOUTUBE_CARD_SELECTOR : null;
    if (!selector || !document?.querySelectorAll) return [];
    const candidates = Array.from(document.querySelectorAll(selector)).filter((card) => {
      if (site === 'x') return !isQuoteDescendant(card, null);
      return !card.closest('ytd-shorts, ytd-reel-video-renderer, #shorts-player')
        && !card.closest(YOUTUBE_AD_SELECTOR) && !card.querySelector(YOUTUBE_AD_SELECTOR)
        && !card.querySelector('ytd-rich-section-renderer, ytd-reel-shelf-renderer')
        && (!card.matches(GENERIC_YOUTUBE_CARD_SELECTOR) || hasVideoDestination(card));
    });
    const candidateSet = new Set(candidates);
    return candidates.filter((card) => {
      for (let ancestor = card.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (candidateSet.has(ancestor)) return false;
      }
      return true;
    });
  }

  function hasVideoDestination(card) {
    const titleLinks = card.querySelectorAll('a#video-title[href], a#video-title-link[href], a.ytLockupMetadataViewModelTitle[href], a.yt-lockup-metadata-view-model__title[href]');
    const links = titleLinks.length ? titleLinks : card.querySelectorAll('a[href]');
    return Array.from(links).some((link) => {
      const href = link.getAttribute('href');
      // Generic lockups also render channels, playlists, games, and promotions.
      return (/^(?:https?:\/\/(?:www\.)?youtube\.com)?\/watch\?/.test(href)
        && /[?&]v=[^&#]+/.test(href))
        || /^(?:https?:\/\/(?:www\.)?youtube\.com)?\/shorts\/[^/?#]+/.test(href);
    });
  }

  // Quoted posts are nested interactive blocks, not the main tweet's footer.
  function isQuoteDescendant(element, card) {
    for (let ancestor = element.parentElement; ancestor && ancestor !== card; ancestor = ancestor.parentElement) {
      if (ancestor.matches('[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]')) return true;
      if (ancestor.matches(X_CARD_SELECTOR)) return true;
    }
    return false;
  }

  function uniqueCount(counts) {
    const knownCounts = [...new Set(counts.filter((count) => count !== null))];
    return knownCounts.length === 1 ? knownCounts[0] : null;
  }

  function labeledCounts(text, locale) {
    if (!text) return [];
    const matcher = new RegExp(`(?<![\\p{L}\\p{N}.,+\\-])(${COUNT_TOKEN})\\s+${VIEW_WORD}(?![\\p{L}])`, 'giu');
    return Array.from(text.matchAll(matcher), (match) => parseViewCount(match[0], { locale }));
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
    const metadata = Array.from(card.querySelectorAll([
      '#metadata-line > span', '.inline-metadata-item',
      '.yt-content-metadata-view-model__metadata-text',
      '.ytContentMetadataViewModelMetadataText',
      '.shortsLockupViewModelHostMetadataSubhead',
      '.yt-shorts-lockup-view-model__metadata-subhead',
      '#view-count',
    ].join(',')));
    const counts = metadata.flatMap((element) => {
      // Channel names share the same metadata class as counts on modern cards.
      if (element.closest(YOUTUBE_CHANNEL_SELECTOR) || element.querySelector('a[href]')
          || element.querySelector(YOUTUBE_CHANNEL_SELECTOR)) return [];
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

    const links = card.querySelectorAll('a#video-title[aria-label], a#video-title-link[aria-label], a.yt-lockup-metadata-view-model__title[aria-label]');
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

  const core = { parseViewCount, isSupportedPage, getCards, getViewCount, getHideTarget };
  root.MinimumViewsCore = core;
  if (typeof module === 'object' && module.exports) module.exports = core;
})(typeof globalThis === 'object' ? globalThis : this);
