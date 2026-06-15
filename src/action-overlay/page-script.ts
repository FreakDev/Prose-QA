import { writeFileSync } from "node:fs";

export interface ActionOverlayScriptOptions {
  bridgeUrl: string;
}

/**
 * In-page action overlay injected via agent-browser --init-script.
 * Exposes window.__pqaOverlay for preview animations and HUD controls.
 */
export function buildActionOverlayScript(
  options: ActionOverlayScriptOptions,
): string {
  const bridgeUrl = JSON.stringify(options.bridgeUrl);
  return `(() => {
  if (window.__pqaOverlay) return;

  const BRIDGE_URL = ${bridgeUrl};
  const ROOT_ID = "pqa-action-overlay-root";
  const PANEL_ID = "pqa-overlay-panel";
  const PANEL_HEADER_ID = "pqa-overlay-panel-header";
  const PANEL_TITLE_ID = "pqa-overlay-panel-title";
  const PANEL_BODY_ID = "pqa-overlay-panel-body";
  const PLAY_PAUSE_BTN_ID = "pqa-overlay-play-pause-btn";
  const STOP_BTN_ID = "pqa-overlay-stop-btn";
  const HIGHLIGHT_CLASS = "pqa-overlay-highlight";
  const CURSOR_CLASS = "pqa-overlay-cursor";
  const MOVE_MS = 750;
  const FADE_OUT_MS = 500;
  const MAX_ENTRIES = 3;
  const PANEL_WIDTH = 320;
  const PANEL_HEIGHT = 280;
  const PANEL_MARGIN = 12;

  let panelLeft = null;
  let panelTop = null;
  let dragActive = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let scenarioName = "";
  let running = true;
  let controlsEnabled = true;

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
      "#pqa-action-overlay-root .pqa-overlay-panel {",
      "  position: fixed; width: 320px; height: 280px;",
      "  display: flex; flex-direction: column;",
      "  border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.35);",
      "  overflow: hidden; pointer-events: auto;",
      "  background: rgba(15, 23, 42, 0.7); color: #f8fafc;",
      "  font: 500 13px/1.4 system-ui, -apple-system, sans-serif;",
      "  transition: background 0.15s ease;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-panel:hover {",
      "  background: rgba(15, 23, 42, 1);",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-panel-header {",
      "  height: 36px; flex-shrink: 0; display: flex; align-items: center;",
      "  gap: 8px; padding: 0 8px 0 12px; cursor: grab;",
      "  background: rgba(255,255,255,0.06);",
      "  border-bottom: 1px solid rgba(148, 163, 184, 0.25);",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-panel-header:active { cursor: grabbing; }",
      "#pqa-action-overlay-root .pqa-overlay-panel-title {",
      "  flex: 1; min-width: 0; font-size: 12px; font-weight: 600;",
      "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-panel-controls {",
      "  display: flex; align-items: center; gap: 2px; flex-shrink: 0;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-control-btn {",
      "  width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px;",
      "  background: transparent; color: #e2e8f0; cursor: pointer;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-control-btn:hover {",
      "  background: rgba(255,255,255,0.1);",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-control-btn:disabled {",
      "  opacity: 0.35; cursor: default; pointer-events: none;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-panel-body {",
      "  flex: 1; overflow-y: auto; padding: 8px 12px; text-align: left;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-entry {",
      "  padding: 8px 0;",
      "  border-bottom: 1px solid rgba(148, 163, 184, 0.2);",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-entry:last-child { border-bottom: none; }",
      "#pqa-action-overlay-root .pqa-overlay-entry-intent {",
      "  display: block; font-size: 14px; font-weight: 600; line-height: 1.35;",
      "  word-break: break-word; white-space: pre-wrap;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-entry-command {",
      "  display: block; margin-top: 4px; font-size: 12px; font-weight: 500;",
      "  color: #94a3b8; line-height: 1.45; word-break: break-word;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-highlight {",
      "  position: fixed; border: 3px solid #f59e0b;",
      "  background: rgba(245, 158, 11, 0.15); border-radius: 4px;",
      "  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25);",
      "  opacity: 1;",
      "  transition: top 0.75s ease, left 0.75s ease, width 0.75s ease, height 0.75s ease, opacity 0.5s ease;",
      "  pointer-events: none;",
      "}",
      "#pqa-action-overlay-root .pqa-overlay-cursor {",
      "  position: fixed; width: 32px; height: 32px;",
      "  margin-left: -4px; margin-top: -2px;",
      "  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45));",
      "  opacity: 1;",
      "  transition: top 0.75s ease, left 0.75s ease, opacity 0.5s ease;",
      "  pointer-events: none;",
      "}",
    ].join("\\n");
    document.documentElement.appendChild(style);
  }

  const ICONS = {
    play:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    pause:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    stop:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
  };

  function postControl(action) {
    if (!BRIDGE_URL) return;
    fetch(BRIDGE_URL + "/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  }

  function updateTitleText() {
    const title = document.getElementById(PANEL_TITLE_ID);
    if (title) title.textContent = scenarioName;
  }

  function updatePlayPauseIcon() {
    const btn = document.getElementById(PLAY_PAUSE_BTN_ID);
    if (!btn) return;
    btn.innerHTML = running ? ICONS.pause : ICONS.play;
    btn.setAttribute("aria-label", running ? "Pause" : "Play");
    btn.title = running ? "Pause" : "Play";
  }

  function setControlsEnabled(enabled) {
    controlsEnabled = enabled;
    const playPause = document.getElementById(PLAY_PAUSE_BTN_ID);
    const stopBtn = document.getElementById(STOP_BTN_ID);
    if (playPause) playPause.disabled = !enabled;
    if (stopBtn) stopBtn.disabled = !enabled;
  }

  function defaultPanelPosition() {
    return {
      left: Math.max(PANEL_MARGIN, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN),
      top: PANEL_MARGIN,
    };
  }

  function applyPanelPosition(panel) {
    const left = panelLeft ?? defaultPanelPosition().left;
    const top = panelTop ?? defaultPanelPosition().top;
    Object.assign(panel.style, {
      left: left + "px",
      top: top + "px",
      right: "auto",
      transform: "none",
    });
  }

  function onDragMove(event) {
    if (!dragActive) return;
    panelLeft = event.clientX - dragOffsetX;
    panelTop = event.clientY - dragOffsetY;
    const panel = document.getElementById(PANEL_ID);
    if (panel) applyPanelPosition(panel);
  }

  function onDragEnd() {
    dragActive = false;
  }

  function bindHeaderDrag(header, panel) {
    header.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".pqa-overlay-control-btn")) return;
      dragActive = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      panelLeft = rect.left;
      panelTop = rect.top;
      event.preventDefault();
    });
  }

  function ensurePanel(root) {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "pqa-overlay-panel";

    const header = document.createElement("div");
    header.id = PANEL_HEADER_ID;
    header.className = "pqa-overlay-panel-header";

    const title = document.createElement("div");
    title.id = PANEL_TITLE_ID;
    title.className = "pqa-overlay-panel-title";
    title.textContent = scenarioName;

    const controls = document.createElement("div");
    controls.className = "pqa-overlay-panel-controls";

    const playPauseBtn = document.createElement("button");
    playPauseBtn.id = PLAY_PAUSE_BTN_ID;
    playPauseBtn.type = "button";
    playPauseBtn.className = "pqa-overlay-control-btn";
    playPauseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!controlsEnabled) return;
      if (running) {
        running = false;
        updatePlayPauseIcon();
        postControl("pause");
      } else {
        running = true;
        updatePlayPauseIcon();
        postControl("play");
      }
    });

    const stopBtn = document.createElement("button");
    stopBtn.id = STOP_BTN_ID;
    stopBtn.type = "button";
    stopBtn.className = "pqa-overlay-control-btn";
    stopBtn.innerHTML = ICONS.stop;
    stopBtn.setAttribute("aria-label", "Stop");
    stopBtn.title = "Stop";
    stopBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!controlsEnabled) return;
      setControlsEnabled(false);
      postControl("stop");
    });

    controls.appendChild(playPauseBtn);
    controls.appendChild(stopBtn);
    header.appendChild(title);
    header.appendChild(controls);
    bindHeaderDrag(header, panel);

    const body = document.createElement("div");
    body.id = PANEL_BODY_ID;
    body.className = "pqa-overlay-panel-body";

    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);
    applyPanelPosition(panel);
    updatePlayPauseIcon();
    setControlsEnabled(controlsEnabled);

    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);

    return panel;
  }

  let animationMoveTimer = null;
  let animationFadeTimer = null;

  function clearAnimationTimers() {
    if (animationMoveTimer) {
      clearTimeout(animationMoveTimer);
      animationMoveTimer = null;
    }
    if (animationFadeTimer) {
      clearTimeout(animationFadeTimer);
      animationFadeTimer = null;
    }
  }

  function clearAnimation(root) {
    clearAnimationTimers();
    root.querySelectorAll("." + HIGHLIGHT_CLASS + ", ." + CURSOR_CLASS).forEach((el) => el.remove());
  }

  function scheduleAnimationFadeOut(highlight, cursor) {
    clearAnimationTimers();
    animationMoveTimer = setTimeout(() => {
      animationMoveTimer = null;
      if (highlight && highlight.isConnected) highlight.style.opacity = "0";
      if (cursor && cursor.isConnected) cursor.style.opacity = "0";
      animationFadeTimer = setTimeout(() => {
        animationFadeTimer = null;
        if (highlight && highlight.isConnected) highlight.remove();
        if (cursor && cursor.isConnected) cursor.remove();
      }, FADE_OUT_MS);
    }, MOVE_MS);
  }

  function clearOverlay() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.replaceChildren();
  }

  function clearEntryStack() {
    const body = document.getElementById(PANEL_BODY_ID);
    if (body) body.replaceChildren();
  }

  function setScenario(name) {
    ensureStyles();
    const root = ensureRoot();
    ensurePanel(root);
    scenarioName = String(name || "");
    running = true;
    setControlsEnabled(true);
    updateTitleText();
    updatePlayPauseIcon();
    clearEntryStack();
  }

  function setOutcome(outcome) {
    ensureStyles();
    const root = ensureRoot();
    ensurePanel(root);
    const suffix = String(outcome || "");
    scenarioName = scenarioName
      ? scenarioName + " · " + suffix
      : suffix;
    running = false;
    updateTitleText();
    updatePlayPauseIcon();
    setControlsEnabled(false);
  }

  function normalizeEntryPayload(input) {
    if (typeof input === "string") {
      return { command: input, intent: "" };
    }
    if (input && typeof input === "object") {
      const command =
        input.command != null && input.command !== ""
          ? String(input.command)
          : input.detail != null && input.detail !== ""
            ? String(input.detail)
            : input.label != null && input.label !== ""
              ? String(input.label)
              : "";
      return {
        command,
        intent: input.intent ? String(input.intent) : "",
      };
    }
    return { command: "", intent: "" };
  }

  function trimEntryStack(body) {
    while (body.children.length >= MAX_ENTRIES) {
      body.firstElementChild?.remove();
    }
  }

  function scrollPanelToBottom(body) {
    body.scrollTop = body.scrollHeight;
  }

  function appendEntry(root, payload) {
    const { command, intent } = normalizeEntryPayload(payload);
    if (!command && !intent) return;

    const panel = ensurePanel(root);
    const body = panel.querySelector("#" + PANEL_BODY_ID);
    if (!body) return;

    trimEntryStack(body);

    const entry = document.createElement("div");
    entry.className = "pqa-overlay-entry";

    if (intent) {
      const text = document.createElement("span");
      text.className = "pqa-overlay-entry-intent";
      text.textContent = intent;
      entry.appendChild(text);
    }
    if (command) {
      const cmd = document.createElement("span");
      cmd.className = "pqa-overlay-entry-command";
      cmd.textContent = command;
      entry.appendChild(cmd);
    }

    body.appendChild(entry);
    scrollPanelToBottom(body);
  }

  function showHud(payload) {
    ensureStyles();
    const root = ensureRoot();
    clearAnimation(root);
    appendEntry(root, payload);
  }

  function scrollBoxIntoView(box) {
    const w = typeof box.width === "number" ? box.width : 0;
    const h = typeof box.height === "number" ? box.height : 0;
    let x = box.x;
    let y = box.y;
    const margin = 72;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = x + w / 2;
    const cy = y + h / 2;

    let scrollX = 0;
    let scrollY = 0;

    if (cy < margin) scrollY = cy - margin - (vh - margin) / 2;
    else if (cy > vh - margin) scrollY = cy - (vh + margin) / 2;

    if (cx < margin) scrollX = cx - margin - (vw - margin) / 2;
    else if (cx > vw - margin) scrollX = cx - (vw + margin) / 2;

    if (scrollX !== 0 || scrollY !== 0) {
      window.scrollBy({ top: scrollY, left: scrollX, behavior: "instant" });
      x -= scrollX;
      y -= scrollY;
    }

    return { x, y, width: w, height: h };
  }

  function showMutationAnimation(root, rawBox) {
    if (!rawBox || typeof rawBox.x !== "number" || typeof rawBox.y !== "number") return;

    const box = scrollBoxIntoView(rawBox);
    const w = box.width;
    const h = box.height;
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
    cursor.className = CURSOR_CLASS;
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
        scheduleAnimationFadeOut(highlight, cursor);
      });
    });
  }

  function showMutation(payload) {
    ensureStyles();
    const root = ensureRoot();
    clearAnimation(root);
    appendEntry(root, payload);
    showMutationAnimation(root, payload && payload.box ? payload.box : null);
  }

  window.__pqaOverlay = {
    showHud,
    showMutation,
    clear: clearOverlay,
    setScenario,
    setOutcome,
  };
})();`;
}

export function writeActionOverlayScript(
  destPath: string,
  options: ActionOverlayScriptOptions,
): string {
  const script = buildActionOverlayScript(options);
  writeFileSync(destPath, script, "utf-8");
  return destPath;
}
