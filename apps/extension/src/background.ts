const defaultSettings = {
  serverUrl: 'http://localhost:3318',
  maxScrolls: 80
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(defaultSettings, (existing) => {
    chrome.storage.local.set({
      serverUrl: existing.serverUrl ?? defaultSettings.serverUrl,
      maxScrolls: existing.maxScrolls ?? defaultSettings.maxScrolls
    });
  });
});