(function () {
  "use strict";

  const core = globalThis.MinimumViewsCore;
  const {normalizeSettings} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const HIDDEN_ATTRIBUTE = "data-minimum-views-hidden";
  const SCAN_DELAY_MS = 80;
  const NAVIGATION_CHECK_MS = 1000;
  const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? "youtube" : "x";
  const PAGE_EVENTS = ["popstate", "yt-navigate-finish", "pageshow"];
  let settings = normalizeSettings();
  let hiddenTargets = new Set();
  let pendingScan = null;
  let previousUrl = location.href;
  let ready = false;
  let stopped = false;
  const startupChanges = {};

  /**
   * Reconcile the current DOM with the current settings.
   *
   * Counts are read fresh on every pass, including from hidden cards. The set
   * holds DOM nodes only, never post IDs, so recycled nodes and later count
   * increases cannot inherit a permanent exclusion. Detached nodes are released.
   */
  function scan() {
    pendingScan = null;
    if (stopped || !ready) return;
    const nextHidden = new Set();
    const enabled = settings[SITE + "Enabled"] && core.isSupportedPage(SITE, location.pathname);
    if (enabled) {
      const locale = document.documentElement.lang || navigator.language || "en";
      const minimumViews = settings[SITE + "MinimumViews"];
      const whitelist = new Set(settings[SITE + "Whitelist"]);
      for (const card of core.getCards(document, SITE)) {
        // Re-read creator links so recycled cards cannot inherit an exemption.
        if (whitelist.size && core.getCreatorIdentifiers(card, SITE).some((identifier) => whitelist.has(identifier))) continue;
        const views = core.getViewCount(card, SITE, locale);
        if (views === null ? settings.hideUnknown : views < minimumViews) {
          nextHidden.add(core.getHideTarget(card, SITE));
        }
      }
    }
    // Update only changed attributes; our own mutations never trigger a loop.
    for (const target of hiddenTargets) {
      if (!nextHidden.has(target)) target.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    for (const target of nextHidden) {
      if (!target.hasAttribute(HIDDEN_ATTRIBUTE)) target.setAttribute(HIDDEN_ATTRIBUTE, "");
    }
    hiddenTargets = nextHidden;
  }

  /** Coalesce page mutations into one bounded pass without a trailing debounce. */
  function scheduleScan() {
    if (!stopped && ready && pendingScan === null) pendingScan = setTimeout(scan, SCAN_DELAY_MS);
  }

  const observer = new MutationObserver(scheduleScan);
  // class is needed when YouTube finishes creating metadata spans. The private
  // hidden attribute is deliberately absent to avoid observing our own changes.
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "href", "class", "data-testid", "lang"],
  });
  for (const eventName of PAGE_EVENTS) window.addEventListener(eventName, scheduleScan);

  // SPA routes may change without a DOM mutation or popstate event. This checks
  // only the URL once per second; it does not poll a site or fetch fresh counts.
  const navigationTimer = setInterval(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      scheduleScan();
    }
  }, NAVIGATION_CHECK_MS);

  function onSettingsChanged(changes, area) {
    if (area !== "local") return;
    const updated = {...settings};
    for (const [key, change] of Object.entries(changes)) {
      updated[key] = change.newValue;
      if (!ready) startupChanges[key] = change.newValue;
    }
    settings = normalizeSettings(updated);
    scheduleScan();
  }
  extension.storage.onChanged.addListener(onSettingsChanged);

  /** Release observers on unload, restoring hidden nodes if the context stops. */
  function stop() {
    stopped = true;
    observer.disconnect();
    clearInterval(navigationTimer);
    clearTimeout(pendingScan);
    for (const eventName of PAGE_EVENTS) window.removeEventListener(eventName, scheduleScan);
    extension.storage.onChanged.removeListener(onSettingsChanged);
    for (const target of hiddenTargets) target.removeAttribute(HIDDEN_ATTRIBUTE);
    hiddenTargets.clear();
  }
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) stop();
  }, {once: false});

  extension.storage.local.get(null).then((stored) => {
    // A settings event may beat the initial storage read; do not overwrite it.
    settings = normalizeSettings({...stored, ...startupChanges});
    ready = true;
    scan();
  }).catch(() => {
    // If extension storage is unavailable, leave the page as it was.
    stop();
  });
})();
