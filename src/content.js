(function () {
  "use strict";

  const core = globalThis.MinimumViewsCore;
  const {normalizeSettings} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const HIDDEN_ATTRIBUTE = "data-minimum-views-hidden";
  const ACTIVE_ATTRIBUTE = "data-minimum-views-active";
  const HIDDEN_SELECTOR = "[" + HIDDEN_ATTRIBUTE + "]";
  const SCAN_DELAY_MS = 80;
  const NAVIGATION_CHECK_MS = 1000;
  const MAX_PENDING_ROOTS = 32;
  const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? "youtube" : "x";
  const CARD_SELECTOR = core.getCardSelector(SITE);
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

  function isSuspended() {
    return pageSuspended || document.visibilityState === "hidden";
  }

  /** Find the whole card (or X cell), including outer wrappers around quotes. */
  function cardScope(element) {
    let card = element.closest(CARD_SELECTOR);
    if (!card) return null;
    let outer = card.parentElement?.closest(CARD_SELECTOR);
    while (outer) {
      card = outer;
      outer = card.parentElement?.closest(CARD_SELECTOR);
    }
    return SITE === "x" ? card.closest('[data-testid="cellInnerDiv"]') || card : card;
  }

  /** Hover/focus/theme restyles do not add or remove a class the adapter reads. */
  function changesDecisionClass(record) {
    const previousNames = record.oldValue ? record.oldValue.split(/\s+/) : [];
    return DECISION_CLASS_NAMES.some((name) => record.target.classList.contains(name) !== previousNames.includes(name));
  }

  function containsCardOrMark(element) {
    return element.matches(CARD_SELECTOR + "," + HIDDEN_SELECTOR)
      || element.querySelector(CARD_SELECTOR + "," + HIDDEN_SELECTOR) !== null;
  }

  /** Collapse overlapping scopes; large bursts become one full scan, not a queue. */
  function queueRoot(root) {
    if (fullScanRequired || !root.isConnected) return;
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

  /** Route mutations to cards; sidebar/player changes cannot trigger feed scans. */
  function onMutations(records) {
    if (stopped || !ready || isSuspended()) return;
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      scheduleScan(true);
      return;
    }
    if (fullScanRequired) return;
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
      // Quote role changes and child lists carry more than their target element.
      const routesByTargetOnly = record.type === "characterData"
        || (record.type === "attributes" && record.attributeName !== "role" && record.attributeName !== "data-testid");
      if (routesByTargetOnly) {
        if (routedTargets.has(element)) continue;
        routedTargets.add(element);
      }
      // A formerly hidden wrapper may have lost its card; reconcile its mark
      // before it is reused for another kind of content.
      const scope = cardScope(element) || element.closest(HIDDEN_SELECTOR)
        || (SITE === "x" && record.type === "childList" ? element.closest('[data-testid="cellInnerDiv"]') : null);
      if (scope) {
        queueRoot(scope);
      } else if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && containsCardOrMark(node)) queueRoot(cardScope(node) || node);
        }
      } else if (record.type === "attributes"
          && (record.attributeName === "role" || record.attributeName === "data-testid")
          && containsCardOrMark(element)) {
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
        if (whitelist.size && core.getCreatorIdentifiers(card, SITE).some((identifier) => whitelist.has(identifier))) continue;
        const views = core.getViewCount(card, SITE, locale);
        if (views === null ? settings.hideUnknown : views < minimumViews) nextHidden.add(core.getHideTarget(card, SITE));
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
    navigationTimer = setInterval(() => {
      if (location.href !== previousUrl) {
        previousUrl = location.href;
        scheduleScan(true);
      }
    }, NAVIGATION_CHECK_MS);
  }

  function onVisibilityChange() {
    if (stopped || !ready) return;
    if (isSuspended()) {
      pauseWork();
      clearInterval(navigationTimer);
      navigationTimer = null;
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
    if (area !== "local" || !SETTING_KEYS.some((key) => key in changes)) return;
    const updated = {...settings};
    for (const key of SETTING_KEYS) {
      if (!(key in changes)) continue;
      updated[key] = changes[key].newValue;
      if (!ready) startupChanges[key] = changes[key].newValue;
    }
    const next = normalizeSettings(updated);
    const changed = SETTING_KEYS.some((key) => Array.isArray(next[key])
      ? next[key].length !== settings[key].length || next[key].some((entry, index) => entry !== settings[key][index])
      : next[key] !== settings[key]);
    settings = next;
    if (changed) {
      whitelist = new Set(settings[SITE + "Whitelist"]);
      scheduleScan(true);
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    pauseWork();
    clearInterval(navigationTimer);
    navigationTimer = null;
    for (const eventName of PAGE_EVENTS) window.removeEventListener(eventName, onPageEvent);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    extension.storage.onChanged.removeListener(onSettingsChanged);
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
  extension.storage.local.get(null).then((stored) => {
    if (stopped) return;
    settings = normalizeSettings({...stored, ...startupChanges});
    whitelist = new Set(settings[SITE + "Whitelist"]);
    ready = true;
    onVisibilityChange();
  }).catch(stop);
})();
