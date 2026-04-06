let activeTab = null;

const tabIdEl = document.getElementById("tabId");
const stateEl = document.getElementById("state");
const countEl = document.getElementById("count");
const warnEl = document.getElementById("warn");
const toggleBtn = document.getElementById("toggleBtn");
const clearBtn = document.getElementById("clearBtn");

function setUI(state) {
  tabIdEl.textContent = state.tabId ?? "-";
  countEl.textContent = String(state.totalSyncedTabs ?? 0);
  warnEl.style.display = state.supported ? "none" : "block";

  if (!state.supported) {
    stateEl.textContent = "Unsupported";
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Unavailable on This Page";
    return;
  }

  toggleBtn.disabled = false;
  if (state.enabled) {
    stateEl.textContent = "Synced";
    toggleBtn.textContent = "Remove from Sync";
  } else {
    stateEl.textContent = "Not Synced";
    toggleBtn.textContent = "Join Sync";
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function refreshState() {
  activeTab = await getActiveTab();
  if (!activeTab || activeTab.id == null) {
    setUI({ supported: false, enabled: false, totalSyncedTabs: 0 });
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "get-tab-state",
    tabId: activeTab.id,
    url: activeTab.url || "",
  });
  setUI(response);
}

toggleBtn.addEventListener("click", async () => {
  if (!activeTab || activeTab.id == null) {
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "toggle-tab",
    tabId: activeTab.id,
    url: activeTab.url || "",
  });
  if (response && response.ok) {
    await refreshState();
    return;
  }
  if (response && response.reason === "inject_failed") {
    stateEl.textContent = "Injection Failed";
  }
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-tabs" });
  await refreshState();
});

refreshState();
