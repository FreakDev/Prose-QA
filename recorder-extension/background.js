const DEFAULT_BRIDGE = "http://127.0.0.1:17321";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getBridgeUrl") {
    chrome.storage.local.get(["bridgeUrl"], (data) => {
      sendResponse({ bridgeUrl: data.bridgeUrl || DEFAULT_BRIDGE });
    });
    return true;
  }
  if (message.type === "postEvent" && message.event) {
    chrome.storage.local.get(["bridgeUrl"], async (data) => {
      const bridge = data.bridgeUrl || DEFAULT_BRIDGE;
      try {
        await fetch(`${bridge}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...message.event, ts: Date.now() }),
          keepalive: true,
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    });
    return true;
  }
  return false;
});
