(function () {
  "use strict";

  // Chrome runs this file as a service worker; Firefox lists settings.js first
  // in its background scripts.
  if (!globalThis.MinimumViewsSettings && typeof importScripts === "function") importScripts("settings.js");

  const {SITE_PAGE_PATTERNS, WHITELIST_CREATOR_MESSAGE} = globalThis.MinimumViewsSettings;
  const extension = globalThis.browser || globalThis.chrome;
  const MENU_ITEM_ID = "always-show-creator";
  const RESULT_BADGE_MS = 4000;
  // Badge text and hover title shown on the toolbar icon after a menu click.
  const RESULT_FEEDBACK = {
    added: {text: "✓", title: "Added to whitelist"},
    present: {text: "✓", title: "Already in whitelist"},
    missing: {text: "?", title: "No creator found where you right-clicked"},
    full: {text: "!", title: "Whitelist is too long to sync"},
    failed: {text: "!", title: "Could not update whitelist"},
  };

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
    setTimeout(() => {
      // The tab may have closed; nothing remains to restore then.
      extension.action.setBadgeText({tabId, text: ""}).catch(() => {});
      extension.action.setTitle({tabId, title: defaultTitle}).catch(() => {});
    }, RESULT_BADGE_MS);
  }

  /** Ask the clicked frame's content script, which knows the right-clicked card. */
  async function onMenuClicked(info, tab) {
    if (info.menuItemId !== MENU_ITEM_ID || typeof tab?.id !== "number") return;
    let result = "failed";
    try {
      const response = await extension.tabs.sendMessage(tab.id, {type: WHITELIST_CREATOR_MESSAGE}, {frameId: info.frameId ?? 0});
      result = response?.result || "failed";
    } catch {
      // No content script in that frame, e.g. a tab opened before installation.
      result = "missing";
    }
    await showResult(tab.id, result);
  }

  extension.runtime.onInstalled.addListener(createMenu);
  extension.runtime.onStartup.addListener(createMenu);
  extension.contextMenus.onClicked.addListener(onMenuClicked);
})();
