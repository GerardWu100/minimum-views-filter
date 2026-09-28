(function () {
  "use strict";

  const core = globalThis.MinimumViewsCore;
  const {normalizeSettings, oversizedSyncKeys, STORAGE_AREA, WHITELIST_CREATOR_MESSAGE} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const HIDDEN_ATTRIBUTE = "data-minimum-views-hidden";
  const ACTIVE_ATTRIBUTE = "data-minimum-views-active";
  const HIDDEN_SELECTOR = "[" + HIDDEN_ATTRIBUTE + "]";
  const X_CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
  const SCAN_DELAY_MS = 80;
  const NAVIGATION_CHECK_MS = 1000;
  const MAX_PENDING_ROOTS = 32;
  const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? "youtube" : "x";
  const CARD_SELECTOR = core.getCardSelector(SITE);
  const CARD_OR_MARK_SELECTOR = CARD_SELECTOR + "," + HIDDEN_SELECTOR;
  const PAGE_EVENTS = ["popstate", "yt-navigate-finish", "pageshow"];
  const SETTING_KEYS = [SITE + "MinimumViews", SITE + "Whitelist", SITE + "Enabled", "hideUnknown"];
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
    if (checkNavigation() || fullScanRequired) return;
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
      const scope = (insideCardOrMark && (cardScope(element) || element.closest(HIDDEN_SELECTOR)))
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
    scheduleScan();
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
    document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
    for (const target of document.querySelectorAll(HIDDEN_SELECTOR)) target.removeAttribute(HIDDEN_ATTRIBUTE);
  }

  /**
   * Reconcile only affected DOM subtrees with current settings and metadata.
   *
   * Hiding attributes are the only durable card state. No Set/Map retains hidden
   * DOM nodes or post IDs between passes; detached subtrees can be collected.
   * Both desired targets and existing marks are scoped to the changed roots.
   * Full passes are reserved for startup, navigation, settings and tab resume.
   */
  function scan() {
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
    pendingRoots.clear();
    fullScanRequired = false;
    const nextHidden = new Set();
    const previousHidden = new Set();
    const locale = document.documentElement.lang || navigator.language || "en";
    const minimumViews = settings[SITE + "MinimumViews"];
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 1) {
        // X's safe hide target can be an ancestor of a newly inserted article.
        const ancestor = root.closest(HIDDEN_SELECTOR);
        if (ancestor) previousHidden.add(ancestor);
      }
      for (const target of root.querySelectorAll(HIDDEN_SELECTOR)) previousHidden.add(target);
      for (const card of core.getCards(root, SITE)) {
        const views = core.getViewCount(card, SITE, locale);
        if (!(views === null ? settings.hideUnknown : views < minimumViews)) continue;
        // The whitelist can only rescue a card that would otherwise be hidden.
        if (whitelist.size && core.getCreatorIdentifiers(card, SITE).some((identifier) => whitelist.has(identifier))) continue;
        nextHidden.add(core.getHideTarget(card, SITE));
      }
    }
    for (const target of previousHidden) {
      if (!nextHidden.has(target)) target.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    for (const target of nextHidden) {
      if (!target.hasAttribute(HIDDEN_ATTRIBUTE)) target.setAttribute(HIDDEN_ATTRIBUTE, "");
    }
    if (!document.documentElement.hasAttribute(ACTIVE_ATTRIBUTE)) document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, "");
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
    settings = next;
    if (changed) {
      whitelist = new Set(settings[SITE + "Whitelist"]);
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

  /** Add an identifier to this site's synced whitelist; storage change rescans. */
  async function whitelistCreator(identifier) {
    const key = SITE + "Whitelist";
    const current = normalizeSettings(await extension.storage[STORAGE_AREA].get(key))[key];
    if (current.includes(identifier)) return "present";
    const update = {[key]: [...current, identifier]};
    if (oversizedSyncKeys(update).length) return "full";
    await extension.storage[STORAGE_AREA].set(update);
    return "added";
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
    whitelist = new Set(settings[SITE + "Whitelist"]);
    ready = true;
    onVisibilityChange();
  }).catch(stop);
})();
