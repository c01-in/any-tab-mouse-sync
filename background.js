const STORAGE_KEY = "synced_tab_ids_v1";
let syncedTabIds = new Set();

function isSupportedUrl(url = "") {
  return /^https?:\/\//i.test(url);
}

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const ids = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  syncedTabIds = new Set(ids.filter((id) => Number.isInteger(id)));
}

async function saveState() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: Array.from(syncedTabIds),
  });
}

async function pruneMissingTabs() {
  const ids = Array.from(syncedTabIds);
  let changed = false;
  await Promise.all(
    ids.map(async (tabId) => {
      try {
        await chrome.tabs.get(tabId);
      } catch (_error) {
        syncedTabIds.delete(tabId);
        changed = true;
      }
    })
  );
  if (changed) {
    await saveState();
  }
}

async function notifyTabState(tabId, enabled) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "sync-state",
      enabled,
      totalSyncedTabs: syncedTabIds.size,
    });
  } catch (_error) {
    // Ignore tabs without content script (internal/restricted pages).
  }
}

async function notifyAllSyncedTabs() {
  await Promise.all(
    Array.from(syncedTabIds).map((tabId) => notifyTabState(tabId, true))
  );
}

async function getTabStatus(tabId, url = "") {
  return {
    ok: true,
    tabId,
    supported: isSupportedUrl(url),
    enabled: syncedTabIds.has(tabId),
    totalSyncedTabs: syncedTabIds.size,
  };
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return Boolean(response && response.ok);
  } catch (_error) {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingContentScript(tabId)) {
    return true;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (_error) {
    return false;
  }

  return pingContentScript(tabId);
}

async function toggleTab(tabId, url = "") {
  if (!isSupportedUrl(url)) {
    return {
      ok: false,
      reason: "unsupported_url",
      supported: false,
      enabled: false,
      totalSyncedTabs: syncedTabIds.size,
    };
  }

  let enabled;
  if (syncedTabIds.has(tabId)) {
    syncedTabIds.delete(tabId);
    enabled = false;
  } else {
    const injected = await ensureContentScript(tabId);
    if (!injected) {
      return {
        ok: false,
        reason: "inject_failed",
        supported: true,
        enabled: false,
        totalSyncedTabs: syncedTabIds.size,
      };
    }
    syncedTabIds.add(tabId);
    enabled = true;
  }

  await saveState();
  await notifyTabState(tabId, enabled);
  await notifyAllSyncedTabs();
  return {
    ok: true,
    supported: true,
    enabled,
    totalSyncedTabs: syncedTabIds.size,
  };
}

async function clearTabs() {
  const previousIds = Array.from(syncedTabIds);
  syncedTabIds.clear();
  await saveState();
  await Promise.all(previousIds.map((id) => notifyTabState(id, false)));
  return { ok: true, totalSyncedTabs: 0 };
}

async function relayEvent(senderTabId, event) {
  if (!syncedTabIds.has(senderTabId)) {
    return;
  }

  const targets = Array.from(syncedTabIds).filter((id) => id !== senderTabId);
  await Promise.all(
    targets.map(async (targetTabId) => {
      try {
        await chrome.tabs.sendMessage(targetTabId, {
          type: "remote-event",
          fromTabId: senderTabId,
          event,
        });
      } catch (_error) {
        const injected = await ensureContentScript(targetTabId);
        if (!injected) {
          syncedTabIds.delete(targetTabId);
          return;
        }
        try {
          await chrome.tabs.sendMessage(targetTabId, {
            type: "remote-event",
            fromTabId: senderTabId,
            event,
          });
        } catch (_retryError) {
          syncedTabIds.delete(targetTabId);
        }
      }
    })
  );
  await saveState();
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!syncedTabIds.has(tabId)) {
    return;
  }
  syncedTabIds.delete(tabId);
  await saveState();
  await notifyAllSyncedTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "get-tab-state") {
      sendResponse(await getTabStatus(message.tabId, message.url));
      return;
    }

    if (message.type === "get-self-state") {
      const tab = sender.tab;
      if (!tab || tab.id == null) {
        sendResponse({ ok: false });
        return;
      }
      sendResponse(await getTabStatus(tab.id, tab.url || ""));
      return;
    }

    if (message.type === "toggle-tab") {
      sendResponse(await toggleTab(message.tabId, message.url));
      return;
    }

    if (message.type === "clear-tabs") {
      sendResponse(await clearTabs());
      return;
    }

    if (message.type === "relay-event") {
      const senderTabId = sender.tab && sender.tab.id;
      if (senderTabId == null || !message.event) {
        sendResponse({ ok: false });
        return;
      }
      await relayEvent(senderTabId, message.event);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, reason: "unknown_message" });
  })();

  return true;
});

(async function init() {
  await loadState();
  await pruneMissingTabs();
  await notifyAllSyncedTabs();
})();
