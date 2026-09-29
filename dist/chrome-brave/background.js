(function () {
  "use strict";

  // Chrome runs this file as a service worker; Firefox lists dependencies first
  // in its background scripts.
  if (!globalThis.MinimumViewsSettings && typeof importScripts === "function") importScripts("settings.js");
  if (!globalThis.MinimumViewsHistory && typeof importScripts === "function") importScripts("history-store.js");

  const {SITE_PAGE_PATTERNS, WHITELIST_CREATOR_MESSAGE} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const historyStore = globalThis.MinimumViewsHistory;
  const MENU_ITEM_ID = "always-show-creator";
  const RECORD_MESSAGE = "minimum-views-filter:record-filtered";
  const GET_HISTORY_MESSAGE = "minimum-views-filter:get-history";
  const CLEAR_HISTORY_MESSAGE = "minimum-views-filter:clear-history";
  const RESULT_BADGE_MS = 4000;
  // Badge text and hover title shown on the toolbar icon after a menu click.
  const RESULT_FEEDBACK = {
    added: {text: "✓", title: "Added to whitelist"},
    present: {text: "✓", title: "Already in whitelist"},
    missing: {text: "?", title: "No creator found where you right-clicked"},
    full: {text: "!", title: "Whitelist is too long to sync"},
    failed: {text: "!", title: "Could not update whitelist"},
  };
  // Tab ID -> pending restore timer, so a newer result is not cleared early.
  const badgeRestoreTimers = new Map();
  // Chain every read-modify-write and reset, including requests from other tabs.
  let historyQueue = Promise.resolve();

  function queueHistory(operation) {
    const result = historyQueue.then(operation);
    historyQueue = result.catch(() => {});
    return result;
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

  async function processHistoryMessage(message, sender) {
    if (message.type === RECORD_MESSAGE) {
      const site = senderSite(sender);
      if (!site) return {ok: false, error: "forbidden"};
      if (!Array.isArray(message.items) || message.items.length < 1 || message.items.length > historyStore.MAX_BATCH_ITEMS) {
        return {ok: false, error: "invalid-message"};
      }
      return queueHistory(async () => {
        // Read inside the queue so events waiting behind a reset or another
        // batch honor the current collection switch before any local write.
        const settings = await extension.storage.sync.get("statisticsEnabled");
        if (settings.statisticsEnabled === false) return {ok: true, recorded: 0};
        const stored = await extension.storage.local.get(historyStore.STORAGE_KEY);
        const result = historyStore.addEvents(stored[historyStore.STORAGE_KEY], message.items, site, Date.now());
        if (!result || !result.recorded) return {ok: false, error: "invalid-message"};
        await extension.storage.local.set({[historyStore.STORAGE_KEY]: result.history});
        return {ok: true, recorded: result.recorded};
      });
    }
    const isHistoryPage = isExtensionPage(sender, "history.html");
    if (message.type === GET_HISTORY_MESSAGE && isHistoryPage) {
      return queueHistory(async () => {
        const stored = await extension.storage.local.get(historyStore.STORAGE_KEY);
        return {ok: true, history: historyStore.normalizeHistory(stored[historyStore.STORAGE_KEY])};
      });
    }
    if (!isHistoryPage) return {ok: false, error: "forbidden"};
    return queueHistory(async () => {
      const history = historyStore.emptyHistory();
      await extension.storage.local.set({[historyStore.STORAGE_KEY]: history});
      return {ok: true, history};
    });
  }

  /** Callback response works in both Chrome and Firefox message listeners. */
  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || ![RECORD_MESSAGE, GET_HISTORY_MESSAGE, CLEAR_HISTORY_MESSAGE].includes(message.type)) return false;
    processHistoryMessage(message, sender)
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

  /** Ask the clicked frame's content script, which knows the right-clicked card. */
  async function onMenuClicked(info, tab) {
    if (info.menuItemId !== MENU_ITEM_ID || typeof tab?.id !== "number") return;
    let result;
    try {
      const response = await extension.tabs.sendMessage(tab.id, {type: WHITELIST_CREATOR_MESSAGE}, {frameId: info.frameId ?? 0});
      result = response?.result;
    } catch {
      // No content script in that frame, e.g. a tab opened before installation.
      result = "missing";
    }
    await showResult(tab.id, result);
  }

  extension.runtime.onInstalled.addListener(createMenu);
  extension.runtime.onStartup.addListener(createMenu);
  extension.contextMenus.onClicked.addListener(onMenuClicked);
  extension.runtime.onMessage.addListener(onRuntimeMessage);
})();
