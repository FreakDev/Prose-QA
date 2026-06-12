import { writeFileSync } from "node:fs";

/**
 * In-page action overlay injected via agent-browser --init-script.
 * Exposes window.__pqaOverlay for preview animations before agent actions.
 */
export function buildActionOverlayScript(): string {
  return `(() => {
  if (window.__pqaOverlay) return;

  const ROOT_ID = "pqa-action-overlay-root";
  const HIGHLIGHT_CLASS = "pqa-overlay-highlight";

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
      overflow: "hidden",
    });
    document.documentElement.appendChild(root);
    return root;
  }

  function ensureStyles() {
    if (document.getElementById("pqa-overlay-styles")) return;
    const style = document.createElement("style");
    style.id = "pqa-overlay-styles";
    style.textContent = [
      "#pqa-action-overlay-root .pqa-overlay-hud {",
      "  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);",
      "  max-width: min(90vw, 640px); padding: 10px 16px;",
      "  background: rgba(15, 23, 42, 0.92); color: #f8fafc;",
      "  font: 600 14px/1.35 system-ui, -apple-system, sans-serif;",
      "  border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.35);",
      "  text-align: center;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-hud-title {",
      "  display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-hud-detail {",
      "  display: block; margin-top: 2px;",
      "  font-size: 12px; font-weight: 500; color: #94a3b8;",
      "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-highlight {",
      "  position: fixed; border: 3px solid #f59e0b;",
      "  background: rgba(245, 158, 11, 0.15); border-radius: 4px;",
      "  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25);",
      "  transition: top 0.75s ease, left 0.75s ease, width 0.75s ease, height 0.75s ease;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-cursor {",
      "  position: fixed; width: 32px; height: 32px;",
      "  margin-left: -4px; margin-top: -2px;",
      "  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45));",
      "  transition: top 0.75s ease, left 0.75s ease;",
      "  pointer-events: none;",
      "}",
    ].join("\\n");
    document.documentElement.appendChild(style);
  }

  function clearOverlay() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.replaceChildren();
  }

  function normalizeHudPayload(input) {
    if (typeof input === "string") {
      return { intent: "", detail: input };
    }
    if (input && typeof input === "object") {
      return {
        intent: input.intent ? String(input.intent) : "",
        detail: input.detail ? String(input.detail) : input.label ? String(input.label) : "",
      };
    }
    return { intent: "", detail: "" };
  }

  function appendHud(root, payload) {
    const { intent, detail } = normalizeHudPayload(payload);
    const hud = document.createElement("div");
    hud.className = "pqa-overlay-hud";
    if (intent) {
      const title = document.createElement("span");
      title.className = "pqa-overlay-hud-title";
      title.textContent = intent;
      hud.appendChild(title);
    }
    if (detail) {
      const sub = document.createElement("span");
      sub.className = intent ? "pqa-overlay-hud-detail" : "pqa-overlay-hud-title";
      sub.textContent = detail;
      hud.appendChild(sub);
    }
    root.appendChild(hud);
  }

  function showHud(payload) {
    ensureStyles();
    const root = ensureRoot();
    clearOverlay();
    appendHud(root, payload);
  }

  function showMutation(payload) {
    ensureStyles();
    const root = ensureRoot();
    clearOverlay();

    appendHud(root, payload);
    const box = payload && payload.box ? payload.box : null;

    if (box && typeof box.x === "number" && typeof box.y === "number") {
      const w = typeof box.width === "number" ? box.width : 0;
      const h = typeof box.height === "number" ? box.height : 0;
      const cx = box.x + w / 2;
      const cy = box.y + h / 2;

      const highlight = document.createElement("div");
      highlight.className = HIGHLIGHT_CLASS;
      Object.assign(highlight.style, {
        top: box.y + "px",
        left: box.x + "px",
        width: Math.max(w, 4) + "px",
        height: Math.max(h, 4) + "px",
      });
      root.appendChild(highlight);

      const cursor = document.createElement("div");
      cursor.className = "pqa-overlay-cursor";
      cursor.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">' +
        '<path fill="#f59e0b" stroke="#0f172a" stroke-width="1.2" d="M4 2l14 14h-6l-4 8z"/></svg>';
      const startX = Math.max(0, cx - 100);
      const startY = Math.max(0, cy - 80);
      Object.assign(cursor.style, {
        top: startY + "px",
        left: startX + "px",
      });
      root.appendChild(cursor);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          cursor.style.top = cy + "px";
          cursor.style.left = cx + "px";
        });
      });
    }
  }

  window.__pqaOverlay = {
    showHud,
    showMutation,
    clear: clearOverlay,
  };
})();`;
}

export function writeActionOverlayScript(destPath: string): string {
  const script = buildActionOverlayScript();
  writeFileSync(destPath, script, "utf-8");
  return destPath;
}
