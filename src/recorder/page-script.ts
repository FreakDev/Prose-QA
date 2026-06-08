import { writeFileSync } from "node:fs";
import { buildInPageRecorderHelpers } from "./in-page-helpers.js";

/**
 * In-page recorder injected via agent-browser --init-script.
 * Posts accessibility-oriented events to the local PQA bridge.
 */
export function buildPageRecorderScript(bridgeUrl: string): string {
  const bridge = JSON.stringify(bridgeUrl);
  const helpers = buildInPageRecorderHelpers();
  return `(() => {
  const BRIDGE = ${bridge};
  const sentNav = new Set();
  ${helpers}

  function post(payload) {
    try {
      fetch(BRIDGE + "/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ts: Date.now() }),
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  }

  function recordNavigate() {
    const url = location.href;
    if (sentNav.has(url)) return;
    sentNav.add(url);
    post({ type: "navigate", url });
  }

  let lastRecordedClickKey = "";
  let lastRecordedClickAt = 0;

  function recordClick(ev) {
    if (typeof ev.button === "number" && ev.button !== 0) return;
    const el = resolveClickTarget(ev);
    if (!el) return;
    const payload = {
      type: "click",
      role: roleOf(el),
      name: nameOf(el),
      label: labelOf(el),
      clientX: ev.clientX,
      clientY: ev.clientY,
    };
    const key = [payload.role, payload.name, payload.label].join("|");
    const now = Date.now();
    if (key === lastRecordedClickKey && now - lastRecordedClickAt < 500) return;
    lastRecordedClickKey = key;
    lastRecordedClickAt = now;
    post(payload);
  }

  // MUI Select opens on mousedown + preventDefault(), which suppresses click.
  document.addEventListener("mousedown", recordClick, true);
  document.addEventListener("click", recordClick, true);

  document.addEventListener(
    "change",
    (ev) => {
      const el = targetFromEvent(ev) || asElement(ev.target);
      if (!el) return;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "select") {
        const opt = el.selectedOptions && el.selectedOptions[0];
        post({
          type: "select",
          name: nameOf(el),
          value: opt ? (opt.textContent || opt.value || "").trim().slice(0, 200) : "",
          clientX: ev.clientX,
          clientY: ev.clientY,
        });
        return;
      }
      if (tag === "input" || tag === "textarea") {
        const type = (el.type || "").toLowerCase();
        if (type === "password" || type === "file") {
          post({
            type: "fill",
            role: roleOf(el),
            name: nameOf(el),
            value: "[REDACTED]",
            clientX: ev.clientX,
            clientY: ev.clientY,
          });
          return;
        }
        post({
          type: "fill",
          role: roleOf(el),
          name: nameOf(el),
          value: String(el.value ?? "").slice(0, 500),
          clientX: ev.clientX,
          clientY: ev.clientY,
        });
      }
    },
    true
  );

  document.addEventListener(
    "submit",
    () => {
      post({ type: "submit" });
    },
    true
  );

  const pushState = history.pushState;
  history.pushState = function () {
    pushState.apply(this, arguments);
    recordNavigate();
  };
  const replaceState = history.replaceState;
  history.replaceState = function () {
    replaceState.apply(this, arguments);
    recordNavigate();
  };
  window.addEventListener("popstate", recordNavigate);
  window.addEventListener("hashchange", recordNavigate);

  recordNavigate();
})();`;
}

export function writePageRecorderScript(
  bridgeUrl: string,
  destPath: string,
): string {
  const content = buildPageRecorderScript(bridgeUrl);
  writeFileSync(destPath, content, "utf-8");
  return destPath;
}
