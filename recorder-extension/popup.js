const bridgeInput = document.getElementById("bridge");
const statusEl = document.getElementById("status");

function setStatus(msg, ok = true) {
  statusEl.textContent = msg;
  statusEl.style.color = ok ? "#166534" : "#b91c1c";
}

chrome.storage.local.get(["bridgeUrl"], (data) => {
  if (data.bridgeUrl) bridgeInput.value = data.bridgeUrl;
});

document.getElementById("saveBridge").addEventListener("click", () => {
  const url = bridgeInput.value.trim().replace(/\/$/, "");
  chrome.storage.local.set({ bridgeUrl: url }, () => {
    setStatus("Bridge URL saved.");
  });
});

function promptAndPost(type) {
  const text = prompt(
    type === "comment" ? "Note for scenario generation:" : "Checkpoint hint (Then section):",
  );
  if (!text || !text.trim()) return;
  chrome.runtime.sendMessage(
    { type: "postEvent", event: { type, text: text.trim() } },
    (res) => {
      if (res?.ok) setStatus("Sent to PQA bridge.");
      else setStatus(res?.error || "Bridge unreachable. Is pqa record start running?", false);
    },
  );
}

document.getElementById("note").addEventListener("click", () => promptAndPost("comment"));
document.getElementById("checkpoint").addEventListener("click", () =>
  promptAndPost("checkpoint_hint"),
);
