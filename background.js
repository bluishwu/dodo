chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.action.setBadgeText({ text: 'New' });
    chrome.action.setBadgeBackgroundColor({ color: '#007AFF' });
  }
});
