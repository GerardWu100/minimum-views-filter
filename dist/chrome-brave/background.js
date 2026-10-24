(function () {
  "use strict";

  // Chrome runs this file as a service worker; Firefox lists dependencies first
  // in its background scripts.
  if (!globalThis.MinimumViewsSettings && typeof importScripts === "function") importScripts("settings.js");
  if (!globalThis.MinimumViewsHistory && typeof importScripts === "function") importScripts("history-store.js");

  const {SITE_PAGE_PATTERNS, STORAGE_AREA, WHITELIST_CREATOR_MESSAGE, UPDATE_SETTINGS_MESSAGE, applySettingsUpdate} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const historyStore = globalThis.MinimumViewsHistory;
  const MENU_ITEM_ID = "always-show-creator";
  const RECORD_MESSAGE = "minimum-views-filter:record-filtered";
  const GET_HISTORY_MESSAGE = "minimum-views-filter:get-history";
  const CLEAR_HISTORY_MESSAGE = "minimum-views-filter:clear-history";
  const RESULT_BADGE_MS = 4000;
  const MAX_PENDING_HISTORY_REQUESTS = 256;
  const MAX_PENDING_HISTORY_ITEMS = 2048;
  // Settings edits wait in one queue; more than this many is a runaway sender.
  const MAX_PENDING_SETTINGS_UPDATES = 64;
  // Badge text and hover title shown on the toolbar icon after a menu click.
  const RESULT_FEEDBACK = {
    added: {text: "✓", title: "Added to whitelist"},
    present: {text: "✓", title: "Already in whitelist"},
    "switched-off": {text: "!", title: "In whitelist, but the whitelist is switched off in Settings"},
    missing: {text: "?", title: "No creator found where you right-clicked"},
    full: {text: "!", title: "Whitelist is too long to sync"},
    failed: {text: "!", title: "Could not update whitelist"},
  };
  // Tab ID -> pending restore timer, so a newer result is not cleared early.
  const badgeRestoreTimers = new Map();
  // Only sanitized events and response callbacks wait here, never sender/DOM
  // objects. Limits include the in-flight batch until its responses settle.
  const historyQueue = [];
  let pendingHistoryRequests = 0;
  let pendingHistoryItems = 0;
  let drainingHistory = false;
  // Tail of the settings write queue; each link settles before the next starts.
  let settingsQueueTail = Promise.resolve();
  let pendingSettingsUpdates = 0;

  /**
   * Apply one settings edit after every earlier one has been stored.
   *
   * Each edit re-reads storage inside its turn, so two whitelist additions
   * from different tabs both survive. This serializes writers in this browser
   * only; browser sync between computers can still replace a value written at
   * about the same time elsewhere.
   * Resolves with applySettingsUpdate's result once storage.set has finished,
   * or {ok: false, error: "busy" | "storage-unavailable"}.
   */
  function queueSettingsUpdate(update) {
    if (pendingSettingsUpdates >= MAX_PENDING_SETTINGS_UPDATES) return Promise.resolve({ok: false, error: "busy"});
    pendingSettingsUpdates++;
    const result = settingsQueueTail.then(async () => {
      const outcome = applySettingsUpdate(await extension.storage[STORAGE_AREA].get(null), update);
      if (outcome.ok && Object.keys(outcome.changes).length) await extension.storage[STORAGE_AREA].set(outcome.changes);
      return outcome;
    }).catch(() => ({ok: false, error: "storage-unavailable"})).finally(() => { pendingSettingsUpdates--; });
    settingsQueueTail = result;
    return result;
  }

  /** Queue a bounded history request; overload never delays page filtering. */
  function queueHistory(request) {
    const itemCount = request.items?.length || 0;
    if (pendingHistoryRequests >= MAX_PENDING_HISTORY_REQUESTS || pendingHistoryItems + itemCount > MAX_PENDING_HISTORY_ITEMS) {
      return Promise.resolve({ok: false, error: "history-busy"});
    }
    pendingHistoryRequests++;
    pendingHistoryItems += itemCount;
    return new Promise((resolve) => {
      historyQueue.push({...request, itemCount, resolve});
      if (!drainingHistory) {
        drainingHistory = true;
        // Start in the next microtask, with no collection timer or fixed delay.
        Promise.resolve().then(drainHistoryQueue);
      }
    });
  }

  function finishHistoryRequest(request, response) {
    pendingHistoryRequests--;
    pendingHistoryItems -= request.itemCount;
    request.resolve(response);
  }

  /**
   * Persist up to MAX_EVENT_BATCHES adjacent record messages together.
   *
   * Messages arriving during settings reads may join this batch. Each gets a
   * fresh settings read in arrival order; reads/resets terminate the batch.
   * Responses wait for the local write, and no history cache survives it.
   */
  async function writeHistoryBatch() {
    const requests = [];
    const batches = [];
    const responses = [];
    while (historyQueue[0]?.type === RECORD_MESSAGE && requests.length < historyStore.MAX_EVENT_BATCHES) {
      const request = historyQueue.shift();
      requests.push(request);
      try {
        const settings = await extension.storage.sync.get("statisticsEnabled");
        if (settings.statisticsEnabled === false) responses.push({ok: true, recorded: 0});
        else if (!request.items.length) responses.push({ok: false, error: "invalid-message"});
        else {
          responses.push(null);
          batches.push({items: request.items, site: request.site});
        }
      } catch {
        responses.push({ok: false, error: "storage-unavailable"});
      }
    }
    if (batches.length) {
      try {
        const stored = await extension.storage.local.get(historyStore.STORAGE_KEY);
        const result = historyStore.addEventBatches(stored[historyStore.STORAGE_KEY], batches, Date.now());
        await extension.storage.local.set({[historyStore.STORAGE_KEY]: result.history});
        let batchIndex = 0;
        for (let index = 0; index < responses.length; index++) {
          if (!responses[index]) responses[index] = {ok: true, recorded: result.recordedByBatch[batchIndex++]};
        }
      } catch {
        for (let index = 0; index < responses.length; index++) {
          if (!responses[index]) responses[index] = {ok: false, error: "storage-unavailable"};
        }
      }
    }
    for (let index = 0; index < requests.length; index++) finishHistoryRequest(requests[index], responses[index]);
  }

  /** Serialize batches, reads, and resets across tabs without an unbounded promise chain. */
  async function drainHistoryQueue() {
    while (historyQueue.length) {
      if (historyQueue[0].type === RECORD_MESSAGE) {
        await writeHistoryBatch();
        continue;
      }
      const request = historyQueue.shift();
      let response;
      try {
        let history;
        if (request.type === GET_HISTORY_MESSAGE) {
          const stored = await extension.storage.local.get(historyStore.STORAGE_KEY);
          history = historyStore.normalizeHistory(stored[historyStore.STORAGE_KEY]);
        } else {
          history = historyStore.emptyHistory();
          await extension.storage.local.set({[historyStore.STORAGE_KEY]: history});
        }
        response = {ok: true, history};
      } catch {
        response = {ok: false, error: "storage-unavailable"};
      }
      finishHistoryRequest(request, response);
    }
    drainingHistory = false;
  }

  /** Trust the browser-provided sender URL only on the two supported surfaces. */
  function senderSite(sender) {
    if (sender?.id !== extension.runtime.id || !sender.tab || (sender.frameId !== undefined && sender.frameId !== 0)) return null;
    let url;
    try { url = new URL(sender.url); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) && /^\/home\/?$/.test(url.pathname)) return "x";
    if (["youtube.com", "www.youtube.com"].includes(url.hostname) && (url.pathname === "/" || /^\/watch\/?$/.test(url.pathname))) return "youtube";
    return null;
  }

  /** True when the sender is this extension's own page with that exact file name. */
  function isExtensionPage(sender, fileName) {
    // A history page opened in a browser tab may itself have sender.tab.
    return sender?.id === extension.runtime.id && sender.url === extension.runtime.getURL(fileName);
  }

  /** Accept a settings patch only from the extension's own Settings page. */
  async function processSettingsMessage(message, sender) {
    if (!isExtensionPage(sender, "options.html")) return {ok: false, error: "forbidden"};
    const outcome = await queueSettingsUpdate({values: message.values, whitelists: message.whitelists});
    // The page re-reads storage; full settings objects need not cross the channel.
    return outcome.ok ? {ok: true} : {ok: false, error: outcome.error};
  }

  async function processHistoryMessage(message, sender) {
    if (message.type === RECORD_MESSAGE) {
      const site = senderSite(sender);
      if (!site) return {ok: false, error: "forbidden"};
      if (!Array.isArray(message.items) || message.items.length < 1 || message.items.length > historyStore.MAX_BATCH_ITEMS) {
        return {ok: false, error: "invalid-message"};
      }
      // Copy only bounded, validated fields before retaining a request. Invalid
      // entries cannot retain large message payloads while storage is busy.
      const items = [];
      for (const item of message.items) {
        const event = historyStore.normalizeEvent(item, site, item?.outcome);
        if (event) items.push({...event, outcome: item.outcome, enrich: item.enrich === true});
      }
      return queueHistory({type: RECORD_MESSAGE, items, site});
    }
    const isHistoryPage = isExtensionPage(sender, "history.html");
    if (message.type === GET_HISTORY_MESSAGE && isHistoryPage) {
      return queueHistory({type: GET_HISTORY_MESSAGE});
    }
    if (!isHistoryPage) return {ok: false, error: "forbidden"};
    return queueHistory({type: CLEAR_HISTORY_MESSAGE});
  }

  /** Callback response works in both Chrome and Firefox message listeners. */
  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || ![RECORD_MESSAGE, GET_HISTORY_MESSAGE, CLEAR_HISTORY_MESSAGE, UPDATE_SETTINGS_MESSAGE].includes(message.type)) return false;
    (message.type === UPDATE_SETTINGS_MESSAGE ? processSettingsMessage(message, sender) : processHistoryMessage(message, sender))
      .then(sendResponse)
      .catch(() => sendResponse({ok: false, error: "storage-unavailable"}));
    return true;
  }

  /** Recreate the menu; Chrome keeps menus across restarts, Firefox event pages may not. */
  async function createMenu() {
    await extension.contextMenus.removeAll();
    extension.contextMenus.create({
      id: MENU_ITEM_ID,
      title: "Always show this creator",
      contexts: ["all"],
      documentUrlPatterns: [...SITE_PAGE_PATTERNS],
    });
  }

  /** Show a short per-tab result on the toolbar icon, then restore the default. */
  async function showResult(tabId, result) {
    const feedback = RESULT_FEEDBACK[result] || RESULT_FEEDBACK.failed;
    const defaultTitle = extension.runtime.getManifest().action.default_title;
    await extension.action.setBadgeText({tabId, text: feedback.text});
    await extension.action.setTitle({tabId, title: feedback.title});
    clearTimeout(badgeRestoreTimers.get(tabId));
    badgeRestoreTimers.set(tabId, setTimeout(() => {
      badgeRestoreTimers.delete(tabId);
      // The tab may have closed; nothing remains to restore then.
      extension.action.setBadgeText({tabId, text: ""}).catch(() => {});
      extension.action.setTitle({tabId, title: defaultTitle}).catch(() => {});
    }, RESULT_BADGE_MS));
  }

  /**
   * Add a creator through the settings queue and name the outcome.
   * Returns "added", "present", "full", "failed", or "switched-off" when the
   * entry is stored but the site's whitelist switch keeps it from taking effect.
   */
  async function whitelistCreator(site, identifier) {
    const outcome = await queueSettingsUpdate({whitelists: {[site]: {add: [identifier]}}});
    if (!outcome.ok) return outcome.error === "full" ? "full" : "failed";
    if (!outcome.settings[site + "WhitelistEnabled"]) return "switched-off";
    return Object.hasOwn(outcome.changes, site + "Whitelist") ? "added" : "present";
  }

  /** Ask the clicked frame's content script, which knows the right-clicked card. */
  async function onMenuClicked(info, tab) {
    if (info.menuItemId !== MENU_ITEM_ID || typeof tab?.id !== "number") return;
    let response;
    try {
      response = await extension.tabs.sendMessage(tab.id, {type: WHITELIST_CREATOR_MESSAGE}, {frameId: info.frameId ?? 0});
    } catch {
      // No content script in that frame, e.g. a tab opened before installation.
    }
    // applySettingsUpdate rejects a site or identifier it cannot normalize.
    const result = response?.result === "found" && ["x", "youtube"].includes(response.site)
      ? await whitelistCreator(response.site, response.identifier) : "missing";
    await showResult(tab.id, result);
  }

  /**
   * Give open X/YouTube tabs the current page script after an install or update.
   *
   * Browsers inject manifest content scripts only into pages loaded later. An
   * update or reload leaves earlier copies cut off: they could keep hiding with
   * stale settings while every statistics message fails. The fresh copy makes
   * any cut-off copy in that tab remove its marks and stop (see content.js).
   * Discarded tabs and pages that refuse scripting load the script normally later.
   */
  async function injectIntoOpenTabs() {
    const [contentScript] = extension.runtime.getManifest().content_scripts || [];
    if (!contentScript || !extension.scripting) return;
    const tabs = await extension.tabs.query({url: [...SITE_PAGE_PATTERNS]});
    await Promise.all(tabs.filter((tab) => typeof tab.id === "number" && !tab.discarded).map(async (tab) => {
      const target = {tabId: tab.id};
      try {
        await extension.scripting.insertCSS({target, files: contentScript.css});
        await extension.scripting.executeScript({target, files: contentScript.js});
      } catch {
        // The tab closed, navigated to an error page, or does not allow scripts.
      }
    }));
  }

  async function onInstalled(details) {
    // A browser update (reason "chrome_update") does not replace page scripts.
    if (details?.reason === "install" || details?.reason === "update") injectIntoOpenTabs().catch(() => {});
    await createMenu();
  }

  extension.runtime.onInstalled.addListener(onInstalled);
  extension.runtime.onStartup.addListener(createMenu);
  extension.contextMenus.onClicked.addListener(onMenuClicked);
  extension.runtime.onMessage.addListener(onRuntimeMessage);
})();
