(function () {
  "use strict";

  const core = globalThis.MinimumViewsCore;
  const {normalizeSettings, oversizedSyncKeys, STORAGE_AREA, WHITELIST_CREATOR_MESSAGE, X_SETTING_KEYS} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const HIDDEN_ATTRIBUTE = "data-minimum-views-hidden";
  const HIGHLIGHT_ATTRIBUTE = "data-minimum-views-highlighted";
  const ACTIVE_ATTRIBUTE = "data-minimum-views-active";
  const HIDDEN_SELECTOR = "[" + HIDDEN_ATTRIBUTE + "]";
  const HIGHLIGHT_SELECTOR = "[" + HIGHLIGHT_ATTRIBUTE + "]";
  // Marks an X thread line that would join a shown post to a hidden one.
  const THREAD_CUT_ATTRIBUTE = "data-minimum-views-thread-cut";
  const THREAD_CUT_SELECTOR = "[" + THREAD_CUT_ATTRIBUTE + "]";
  const MARK_SELECTOR = HIDDEN_SELECTOR + "," + HIGHLIGHT_SELECTOR;
  const X_CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
  const SCAN_DELAY_MS = 80;
  const NAVIGATION_CHECK_MS = 1000;
  const MAX_PENDING_ROOTS = 32;
  const HISTORY_BATCH_SIZE = 100;
  const RECORD_FILTERED_MESSAGE = 'minimum-views-filter:record-filtered';
  const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? "youtube" : "x";
  const CARD_SELECTOR = core.getCardSelector(SITE);
  const CARD_OR_MARK_SELECTOR = CARD_SELECTOR + "," + MARK_SELECTOR;
  const PAGE_EVENTS = ["popstate", "yt-navigate-finish", "pageshow"];
  const SETTING_KEYS = [SITE + "MinimumViews", SITE + "MinimumViewsEnabled", SITE + "Whitelist", SITE + "WhitelistEnabled", SITE + "Enabled", "hideUnknown", "statisticsEnabled", ...(SITE === 'x' ? X_SETTING_KEYS : [])];
  const DECISION_CLASS_NAMES = core.getDecisionClassNames(SITE);
  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    // Ignore style/player state and our own marks. X: role/testid can change
    // whether a subtree is a quoted post; X reads no classes. YouTube: title and
    // a few metadata classes establish counts, so class records keep old values.
    attributeFilter: SITE === "x"
      ? ["aria-label", "href", "data-testid", "role", "lang"]
      : ["aria-label", "title", "href", "class", "lang"],
    attributeOldValue: DECISION_CLASS_NAMES.length > 0,
  };
  let settings = normalizeSettings();
  let whitelist = new Set();
  // Weak keys cannot keep removed cards alive; values are only URLs or null.
  // Snippets belong in bounded history messages, not in per-card state.
  // One map per recorded outcome, so a card that flips between hidden and kept
  // records each new continuous state once.
  let recordedHiddenCards = new WeakMap();
  let recordedKeptCards = new WeakMap();
  let recordedHighlightedCards = new WeakMap();
  const pendingRoots = new Set();
  const startupChanges = {};
  let fullScanRequired = false;
  let pendingScan = null;
  let navigationTimer = null;
  let previousUrl = location.href;
  let observing = false;
  let ready = false;
  let stopped = false;
  let pageSuspended = false;
  // Identifier string only: a DOM reference here could retain a detached card.
  let contextMenuCreator = null;

  function isSuspended() {
    return pageSuspended || document.visibilityState === "hidden";
  }

  /** Find the outermost card around an element, so a quoted post maps to its host. */
  function outerCard(element) {
    let card = null;
    for (let match = element.closest(CARD_SELECTOR); match; match = match.parentElement?.closest(CARD_SELECTOR)) card = match;
    return card;
  }

  /** Find the whole card (or X cell), including outer wrappers around quotes. */
  function cardScope(element) {
    const card = outerCard(element);
    if (!card) return null;
    return SITE === "x" ? card.closest(X_CELL_SELECTOR) || card : card;
  }

  /** Return the post card of an X cell holding exactly one post, else null. */
  function soleXCard(cell) {
    const cards = core.getCards(cell, SITE);
    return cards.length === 1 && core.getHideTarget(cards[0], SITE) === cell ? cards[0] : null;
  }

  /** Return the neighbouring X timeline cell, or null at the list edge. */
  function siblingXCell(cell, backward) {
    const sibling = backward ? cell.previousElementSibling : cell.nextElementSibling;
    return sibling?.matches(X_CELL_SELECTOR) ? sibling : null;
  }

  /**
   * Add the X cells joined by thread lines to a partial scan's roots.
   *
   * A reply's visibility decides whether its parent stays visible, so a change
   * to either one must re-evaluate the whole joined group. Only the first and
   * last cell of each root can join cells outside it.
   * Before: changed roots. After: the same roots plus outside thread neighbours.
   */
  function addXThreadNeighbours(roots) {
    const extra = [];
    for (const root of roots) {
      if (!root.isConnected) continue;
      const ownCell = root.closest(X_CELL_SELECTOR);
      const cells = ownCell ? [ownCell] : root.querySelectorAll(X_CELL_SELECTOR);
      if (!cells.length) continue;
      // Walk up while the current post is a joined reply to the cell above.
      for (let cell = cells[0], card = soleXCard(cell); card && core.isXReplyToPreviousPost(card);) {
        cell = siblingXCell(cell, true);
        if (!cell) break;
        extra.push(cell);
        card = soleXCard(cell);
      }
      // Walk down while the cell below is a joined reply to the current one.
      for (let cell = siblingXCell(cells[cells.length - 1], false); cell;) {
        const card = soleXCard(cell);
        if (!card || !core.isXReplyToPreviousPost(card)) break;
        extra.push(cell);
        cell = siblingXCell(cell, false);
      }
    }
    for (const cell of extra) {
      if (roots.some((root) => root.contains(cell))) continue;
      // A root inside this cell would read the same cards twice.
      for (let index = roots.length - 1; index >= 0; index--) {
        if (cell.contains(roots[index])) roots.splice(index, 1);
      }
      roots.push(cell);
    }
  }

  /** Hover/focus/theme restyles do not add or remove a class the adapter reads. */
  function changesDecisionClass(record) {
    const previousNames = record.oldValue ? record.oldValue.split(/\s+/) : [];
    return DECISION_CLASS_NAMES.some((name) => record.target.classList.contains(name) !== previousNames.includes(name));
  }

  function containsCardOrMark(element) {
    return element.matches(CARD_OR_MARK_SELECTOR) || element.querySelector(CARD_OR_MARK_SELECTOR) !== null;
  }

  /** Collapse overlapping scopes; large bursts become one full scan, not a queue. */
  function queueRoot(root) {
    if (fullScanRequired || pendingRoots.has(root) || !root.isConnected) return;
    for (const queued of pendingRoots) {
      if (queued.contains(root)) return;
      if (root.contains(queued)) pendingRoots.delete(queued);
    }
    if (pendingRoots.size >= MAX_PENDING_ROOTS) {
      fullScanRequired = true;
      pendingRoots.clear();
    } else {
      pendingRoots.add(root);
    }
  }

  function scheduleScan(full = false) {
    if (stopped || !ready || isSuspended()) return;
    if (full) {
      fullScanRequired = true;
      pendingRoots.clear();
    }
    if (pendingScan === null && (fullScanRequired || pendingRoots.size)) {
      pendingScan = setTimeout(scan, SCAN_DELAY_MS);
    }
  }

  /** Record a URL change and request a full pass; return whether one occurred. */
  function checkNavigation() {
    if (location.href === previousUrl) return false;
    previousUrl = location.href;
    scheduleScan(true);
    return true;
  }

  /** Route mutations to cards; sidebar/player changes cannot trigger feed scans. */
  function onMutations(records) {
    if (stopped || !ready || isSuspended()) return;
    if (checkNavigation() || fullScanRequired) {
      // A pending full pass must not leave newly arrived cards waiting either.
      scan();
      return;
    }
    // Text/attribute bursts often repeat one target; route each target once.
    const routedTargets = new Set();
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!element?.isConnected) continue;
      if (record.type === "attributes" && record.attributeName === "lang") {
        if (element === document.documentElement) scheduleScan(true);
        continue;
      }
      if (record.type === "attributes" && record.attributeName === "class" && !changesDecisionClass(record)) continue;
      const changesQuoteRole = record.type === "attributes"
        && (record.attributeName === "role" || record.attributeName === "data-testid");
      // Quote role changes and child lists carry more than their target element.
      if (record.type !== "childList" && !changesQuoteRole) {
        if (routedTargets.has(element)) continue;
        routedTargets.add(element);
      }
      // A formerly hidden wrapper may have lost its card; reconcile its mark
      // before it is reused for another kind of content. One ancestor walk
      // rules out sidebar/player records that lie outside every card and mark.
      const insideCardOrMark = element.closest(CARD_OR_MARK_SELECTOR) !== null;
      const scope = (insideCardOrMark && (cardScope(element) || element.closest(MARK_SELECTOR)))
        || (SITE === "x" && record.type === "childList" ? element.closest(X_CELL_SELECTOR) : null);
      if (scope) {
        queueRoot(scope);
      } else if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && containsCardOrMark(node)) queueRoot(cardScope(node) || node);
        }
      } else if (changesQuoteRole && containsCardOrMark(element)) {
        queueRoot(element);
      }
      if (fullScanRequired) break;
    }
    // Evaluate once per delivered mutation batch, before the browser paints.
    // A delay lets a failing card blink on screen, and on X lets the site
    // report it as seen, before it is hidden.
    if (fullScanRequired || pendingRoots.size) scan();
  }

  const observer = new MutationObserver(onMutations);

  /** Release pending element references and native mutation records when idle. */
  function pauseWork() {
    observer.disconnect();
    observing = false;
    clearTimeout(pendingScan);
    pendingScan = null;
    pendingRoots.clear();
    fullScanRequired = false;
  }

  function restorePage() {
    recordedHiddenCards = new WeakMap();
    recordedKeptCards = new WeakMap();
    recordedHighlightedCards = new WeakMap();
    document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
    for (const target of document.querySelectorAll(HIDDEN_SELECTOR)) target.removeAttribute(HIDDEN_ATTRIBUTE);
    for (const target of document.querySelectorAll(HIGHLIGHT_SELECTOR)) target.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    for (const target of document.querySelectorAll(THREAD_CUT_SELECTOR)) target.removeAttribute(THREAD_CUT_ATTRIBUTE);
  }

  /**
   * Reconcile only affected DOM subtrees with current settings and metadata.
   *
   * Hiding attributes hold filter state. History's WeakMap cannot retain detached
   * nodes, and its item identities are never used to decide whether to hide.
   * Both desired targets and existing marks are scoped to the changed roots.
   * Full passes are reserved for startup, navigation, settings and tab resume.
   */
  function scan() {
    // An immediate mutation pass can supersede a scheduled settings/navigation pass.
    clearTimeout(pendingScan);
    pendingScan = null;
    if (stopped || !ready || isSuspended()) return;
    previousUrl = location.href;
    const enabled = settings[SITE + "Enabled"] && core.isSupportedPage(SITE, location.pathname);
    if (!enabled) {
      pauseWork();
      restorePage();
      return;
    }
    if (!observing) {
      observer.observe(document.documentElement, OBSERVER_OPTIONS);
      observing = true;
      fullScanRequired = true;
    }
    const roots = fullScanRequired ? [document] : [...pendingRoots];
    const threadContext = SITE === "x" && settings.xThreadContextEnabled;
    // Thread lines are trimmed even with thread context off, so X always needs
    // the joined neighbours of a changed cell.
    if (SITE === "x" && !fullScanRequired) addXThreadNeighbours(roots);
    pendingRoots.clear();
    fullScanRequired = false;
    // Hide target -> {card, event}. Hiding waits until joined replies are known.
    const hiddenCards = new Map();
    // X cards this pass leaves visible: joined replies can keep their parents,
    // and thread lines toward hidden neighbours are trimmed.
    const visibleCards = [];
    const nextHidden = new Set();
    const previousHidden = new Set();
    const nextHighlighted = new Set();
    const previousHighlighted = new Set();
    const nextThreadCuts = new Set();
    const previousThreadCuts = new Set();
    const locale = document.documentElement.lang || navigator.language || "en";
    // Detection needs bookmark reads only when its result is shown or recorded.
    const highlightDetected = SITE === "x" && settings.xBookmarkHighlightEnabled
      && (settings.xBookmarkHighlightShown || settings.statisticsEnabled);
    let historyItems = [];
    const recordBatch = () => {
      if (!historyItems.length) return;
      // Statistics errors never interrupt filtering or unhide a qualifying card.
      try {
        extension.runtime.sendMessage({type: RECORD_FILTERED_MESSAGE, items: historyItems}).catch(() => {});
      } catch {
        // A replaced extension can invalidate messaging before the tab reloads.
      }
      historyItems = [];
    };
    /** Queue one history event per new item identity in a continuous state. */
    const recordOutcome = (recordedCards, card, event) => {
      if (!settings.statisticsEnabled) return;
      const metadata = core.getItemMetadata(card, SITE);
      const hadPrevious = recordedCards.has(card);
      const previousUrl = recordedCards.get(card);
      // A permalink can arrive after the count. Enrich that first event instead
      // of counting the same continuous state twice. Lost links are not new IDs.
      const enrich = hadPrevious && !previousUrl && !!metadata.url;
      // Text may hydrate or be rewritten by another extension. Only a changed
      // stable URL proves a new item on a continuously tracked recycled node.
      const newItem = !hadPrevious || (metadata.url && previousUrl && metadata.url !== previousUrl);
      if (metadata.url || !previousUrl) recordedCards.set(card, metadata.url);
      if (!newItem && !enrich) return;
      historyItems.push({site: SITE, ...metadata, author: core.getItemAuthor(card, SITE), ...event, ...(enrich ? {enrich: true} : {})});
      if (historyItems.length === HISTORY_BATCH_SIZE) recordBatch();
    };
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 1) {
        // X's safe hide target can be an ancestor of a newly inserted article.
        const ancestor = root.closest(HIDDEN_SELECTOR);
        if (ancestor) previousHidden.add(ancestor);
        if (root.matches(HIGHLIGHT_SELECTOR)) previousHighlighted.add(root);
      }
      for (const target of root.querySelectorAll(HIDDEN_SELECTOR)) previousHidden.add(target);
      for (const target of root.querySelectorAll(HIGHLIGHT_SELECTOR)) previousHighlighted.add(target);
      for (const target of root.querySelectorAll(THREAD_CUT_SELECTOR)) previousThreadCuts.add(target);
      for (const card of core.getCards(root, SITE)) {
        const views = core.getViewCount(card, SITE, locale);
        // The highlight also needs bookmarks on posts that pass all hide rules.
        // When it is inactive, keep the shortcut for irrelevant engagement reads.
        const engagement = SITE === 'x' && views > 0 && (
          highlightDetected
          || (settings.xLowLikeRatioEnabled && settings.xMinimumLikePercent > 0)
          || (settings.xMinimumViewsEnabled && views < settings.xMinimumViews
            && (settings.xHighLikeRatioEnabled || settings.xHighBookmarkRatioEnabled || settings.xHighReplyRatioEnabled))
        )
          ? core.getXEngagement(card, locale) : {likes: null, bookmarks: null, replies: null};
        const {reason, keptBy, bypassedReason} = core.getFilterDecision(views, SITE, settings, engagement);
        // Whitelists bypass hiding; the independent accent may still apply.
        const whitelisted = (reason || keptBy) && whitelist.size
          && core.getCreatorIdentifiers(card, SITE).some((identifier) => whitelist.has(identifier));
        if (!reason) recordedHiddenCards.delete(card);
        if (!keptBy) recordedKeptCards.delete(card);
        // A qualifying post is recorded even while its outline is switched off.
        const highlighted = highlightDetected && (!reason || whitelisted)
          && core.shouldHighlightX(views, engagement, settings);
        if (highlighted) {
          if (settings.xBookmarkHighlightShown) nextHighlighted.add(card);
          recordOutcome(recordedHighlightedCards, card, {outcome: "highlighted", reason: "high-bookmark-ratio", views, ...engagement});
        } else {
          recordedHighlightedCards.delete(card);
        }
        if (whitelisted) {
          recordedHiddenCards.delete(card);
          recordedKeptCards.delete(card);
        } else if (keptBy) {
          recordOutcome(recordedKeptCards, card, {outcome: "kept", reason: keptBy, bypassedReason, views, ...engagement});
        } else if (reason) {
          hiddenCards.set(core.getHideTarget(card, SITE), {card, event: {outcome: "hidden", reason, views, ...engagement}});
          continue;
        }
        if (SITE === "x") visibleCards.push(card);
      }
    }
    // A visible reply keeps the post it answers visible, and so on up the
    // joined thread, so the reply never shows without its context. Rescued
    // parents are not hidden, so they leave no hidden-history event.
    for (const card of threadContext ? visibleCards : []) {
      for (let reply = card, cell = card.closest(X_CELL_SELECTOR); cell;) {
        const parentCell = siblingXCell(cell, true);
        // Only a sole-post cell is its own hide target, so this also skips shared cells.
        const hiddenParent = parentCell && hiddenCards.get(parentCell);
        // Thread groups join single-post cells only, matching addXThreadNeighbours.
        if (!hiddenParent || core.getHideTarget(reply, SITE) !== cell || !core.isXReplyToPreviousPost(reply)) break;
        hiddenCards.delete(parentCell);
        recordedHiddenCards.delete(hiddenParent.card);
        reply = hiddenParent.card;
        cell = parentCell;
      }
    }
    for (const [target, {card, event}] of hiddenCards) {
      nextHidden.add(target);
      recordOutcome(recordedHiddenCards, card, event);
    }
    for (const target of previousHidden) {
      if (!nextHidden.has(target)) target.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    for (const target of nextHidden) {
      if (!target.hasAttribute(HIDDEN_ATTRIBUTE)) target.setAttribute(HIDDEN_ATTRIBUTE, "");
    }
    for (const target of previousHighlighted) {
      if (!nextHighlighted.has(target)) target.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    }
    for (const target of nextHighlighted) {
      if (!target.hasAttribute(HIGHLIGHT_ATTRIBUTE)) target.setAttribute(HIGHLIGHT_ATTRIBUTE, "");
    }
    // A hidden joined reply or parent would leave the shown post's thread line
    // pointing at the next, unrelated post. Hidden marks are final here, and
    // neighbours outside the roots keep their marks from earlier passes.
    for (const card of visibleCards) {
      const cell = card.closest(X_CELL_SELECTOR);
      if (!cell || core.getHideTarget(card, SITE) !== cell) continue;
      const below = siblingXCell(cell, false);
      const reply = below?.hasAttribute(HIDDEN_ATTRIBUTE) && soleXCard(below);
      const outgoing = reply && core.isXReplyToPreviousPost(reply) && core.getXOutgoingThreadLine(card);
      if (outgoing) nextThreadCuts.add(outgoing);
      const above = siblingXCell(cell, true);
      const incoming = above?.hasAttribute(HIDDEN_ATTRIBUTE) && core.getXIncomingThreadLine(card);
      if (incoming) nextThreadCuts.add(incoming);
    }
    for (const target of previousThreadCuts) {
      if (!nextThreadCuts.has(target)) target.removeAttribute(THREAD_CUT_ATTRIBUTE);
    }
    for (const target of nextThreadCuts) {
      if (!target.hasAttribute(THREAD_CUT_ATTRIBUTE)) target.setAttribute(THREAD_CUT_ATTRIBUTE, "");
    }
    if (!document.documentElement.hasAttribute(ACTIVE_ATTRIBUTE)) document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, "");
    recordBatch();
  }

  /** Poll only URL changes, only while visible; never poll counts or the network. */
  function startNavigationCheck() {
    if (navigationTimer !== null) return;
    navigationTimer = setInterval(checkNavigation, NAVIGATION_CHECK_MS);
  }

  function stopNavigationCheck() {
    clearInterval(navigationTimer);
    navigationTimer = null;
  }

  function onVisibilityChange() {
    if (stopped || !ready) return;
    if (isSuspended()) {
      pauseWork();
      stopNavigationCheck();
    } else {
      startNavigationCheck();
      fullScanRequired = true;
      scan();
    }
  }

  function onPageEvent(event) {
    if (event.type === "pageshow") pageSuspended = false;
    if (stopped || !ready || isSuspended()) return;
    startNavigationCheck();
    scheduleScan(true);
  }

  function onSettingsChanged(changes, area) {
    if (area !== STORAGE_AREA || !SETTING_KEYS.some((key) => key in changes)) return;
    // Before startup resolves, record changes to merge over the stored values.
    const updated = ready ? {...settings} : startupChanges;
    for (const key of SETTING_KEYS) {
      if (key in changes) updated[key] = changes[key].newValue;
    }
    if (!ready) return;
    const next = normalizeSettings(updated);
    // Values are numbers, booleans, or arrays of strings, so JSON equality is exact.
    const changed = SETTING_KEYS.some((key) => JSON.stringify(next[key]) !== JSON.stringify(settings[key]));
    if (next.statisticsEnabled !== settings.statisticsEnabled) {
      recordedHiddenCards = new WeakMap();
      recordedKeptCards = new WeakMap();
      recordedHighlightedCards = new WeakMap();
    }
    settings = next;
    if (changed) {
      whitelist = new Set(settings[SITE + "WhitelistEnabled"] ? settings[SITE + "Whitelist"] : []);
      scheduleScan(true);
    }
  }

  /**
   * Resolve the creator for a right-click, using only unambiguous author metadata.
   *
   * Inside a card this is the clicked card's own author (never a mention,
   * quoted author, or another post sharing the X cell); elsewhere, including
   * non-video YouTube lockups, it is a profile/channel link under the pointer.
   */
  function creatorAt(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return null;
    const outer = outerCard(element);
    const card = outer ? core.getCards(outer, SITE)[0] : null;
    if (card) {
      const identifiers = core.getCreatorIdentifiers(card, SITE);
      return identifiers.length === 1 ? identifiers[0] : null;
    }
    const link = element.closest("a[href]");
    return link ? core.getLinkCreatorIdentifier(link, SITE) : null;
  }

  function onContextMenu(event) {
    contextMenuCreator = creatorAt(event.target);
  }

  /**
   * Add an identifier to this site's synced whitelist; storage change rescans.
   * Returns "added", "present", "full", or "switched-off" when the entry is
   * stored but the site's whitelist switch keeps it from taking effect.
   */
  async function whitelistCreator(identifier) {
    const key = SITE + "Whitelist";
    const switchKey = SITE + "WhitelistEnabled";
    const stored = normalizeSettings(await extension.storage[STORAGE_AREA].get([key, switchKey]));
    const current = stored[key];
    const result = current.includes(identifier) ? "present" : "added";
    if (result === "added") {
      const update = {[key]: [...current, identifier]};
      if (oversizedSyncKeys(update).length) return "full";
      await extension.storage[STORAGE_AREA].set(update);
    }
    return stored[switchKey] ? result : "switched-off";
  }

  /** Answer the background's context-menu request with sendResponse (Chrome and Firefox). */
  function onRuntimeMessage(message, sender, sendResponse) {
    if (message?.type !== WHITELIST_CREATOR_MESSAGE) return false;
    const identifier = contextMenuCreator;
    contextMenuCreator = null;
    if (!identifier) {
      sendResponse({result: "missing"});
      return false;
    }
    whitelistCreator(identifier).then(
      (result) => sendResponse({result, identifier}),
      () => sendResponse({result: "failed"}),
    );
    return true;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    pauseWork();
    stopNavigationCheck();
    for (const eventName of PAGE_EVENTS) window.removeEventListener(eventName, onPageEvent);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    extension.storage.onChanged.removeListener(onSettingsChanged);
    document.removeEventListener("contextmenu", onContextMenu, true);
    extension.runtime.onMessage.removeListener(onRuntimeMessage);
    contextMenuCreator = null;
    restorePage();
  }

  function onPageHide(event) {
    if (event.persisted) {
      pageSuspended = true;
      onVisibilityChange();
    } else {
      stop();
    }
  }

  for (const eventName of PAGE_EVENTS) window.addEventListener(eventName, onPageEvent);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  extension.storage.onChanged.addListener(onSettingsChanged);
  // Capture phase: record the author before page handlers can stop the event.
  document.addEventListener("contextmenu", onContextMenu, true);
  extension.runtime.onMessage.addListener(onRuntimeMessage);
  extension.storage[STORAGE_AREA].get(null).then((stored) => {
    if (stopped) return;
    settings = normalizeSettings({...stored, ...startupChanges});
    whitelist = new Set(settings[SITE + "WhitelistEnabled"] ? settings[SITE + "Whitelist"] : []);
    ready = true;
    onVisibilityChange();
  }).catch(stop);
})();
