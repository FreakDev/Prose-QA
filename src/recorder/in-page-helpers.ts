/**
 * Browser-side helpers embedded in the page recorder and Chrome extension.
 * Keep this file free of Node imports — it is inlined into injected scripts.
 */
export function buildInPageRecorderHelpers(): string {
  return `
  const INTERACTIVE_ROLES = new Set([
    "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "tab", "combobox", "listbox", "checkbox", "radio", "switch",
    "slider", "textbox", "searchbox", "spinbutton", "gridcell", "row",
    "treeitem", "cell",
  ]);
  const INTERACTIVE_TAGS = new Set([
    "button", "a", "input", "select", "textarea", "summary", "label",
  ]);
  const NON_INTERACTIVE_TAGS = new Set(["html", "body", "head"]);

  function asElement(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    if (node.nodeType === 3 && node.parentElement) return node.parentElement;
    return null;
  }

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    try {
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none"
      ) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function implicitRole(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "a" && el.hasAttribute && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input" && el.type) {
      const type = String(el.type).toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "hidden") return null;
      return "textbox";
    }
    return null;
  }

  function isSnapshotInteractive(el) {
    if (!el || el.nodeType !== 1 || isHidden(el)) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (NON_INTERACTIVE_TAGS.has(tag)) return false;
    if (INTERACTIVE_TAGS.has(tag)) return true;
    const role =
      (el.getAttribute && el.getAttribute("role")?.toLowerCase()) ||
      implicitRole(el);
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    const hasPopup = el.getAttribute && el.getAttribute("aria-haspopup");
    if (hasPopup && hasPopup !== "false") return true;
    const tabindex = el.getAttribute && el.getAttribute("tabindex");
    if (tabindex != null && String(tabindex) !== "-1") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function pushCandidate(list, el) {
    if (el && list.indexOf(el) === -1) list.push(el);
  }

  function containsPoint(el, x, y) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const rect = el.getBoundingClientRect();
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  function interactiveInSubtreeAtPoint(root, x, y) {
    if (!root || !root.querySelectorAll) return null;
    const nodes = root.querySelectorAll(
      'button, a, input, select, textarea, [role], [tabindex]:not([tabindex="-1"]), [aria-haspopup]'
    );
    let best = null;
    let bestArea = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!isSnapshotInteractive(node) || !containsPoint(node, x, y)) continue;
      const rect = node.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < bestArea) {
        best = node;
        bestArea = area;
      }
    }
    return best;
  }

  function resolveFromAncestorsAtPoint(start, x, y) {
    let root = start;
    while (root && root.nodeType === 1) {
      const tag = root.tagName ? root.tagName.toLowerCase() : "";
      if (tag !== "html" && tag !== "body") {
        const hit = interactiveInSubtreeAtPoint(root, x, y);
        if (hit) return hit;
      }
      root = root.parentElement;
    }
    return null;
  }

  function findRelatedCombobox(start) {
    let root = start;
    while (root && root.nodeType === 1) {
      const tag = root.tagName ? root.tagName.toLowerCase() : "";
      if (tag === "html" || tag === "body") break;
      if (root.querySelector) {
        const combo = root.querySelector('[role="combobox"]');
        if (combo && isSnapshotInteractive(combo)) return combo;
      }
      root = root.parentElement;
    }
    return null;
  }

  function resolveClickTarget(ev) {
    const path =
      typeof ev.composedPath === "function" ? ev.composedPath() : [];
    const candidates = [];
    const x = ev.clientX;
    const y = ev.clientY;

    if (typeof document.elementFromPoint === "function") {
      pushCandidate(candidates, asElement(document.elementFromPoint(x, y)));
    }

    let target = asElement(ev.target);
    if (target) pushCandidate(candidates, target);

    for (let i = 0; i < path.length; i++) {
      pushCandidate(candidates, asElement(path[i]));
    }

    for (let c = 0; c < candidates.length; c++) {
      let el = candidates[c];
      while (el && el.nodeType === 1) {
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        if (tag === "html" || tag === "body") {
          el = el.parentElement;
          continue;
        }
        if (isSnapshotInteractive(el)) return el;
        el = el.parentElement;
      }
    }

    for (let c = 0; c < candidates.length; c++) {
      const hit = resolveFromAncestorsAtPoint(candidates[c], x, y);
      if (hit) return hit;
    }

    for (let c = 0; c < candidates.length; c++) {
      const combo = findRelatedCombobox(candidates[c]);
      if (combo) return combo;
    }

    return null;
  }

  function roleOf(el) {
    if (!el || el.nodeType !== 1) return undefined;
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit.toLowerCase();
    const implicit = implicitRole(el);
    if (implicit) return implicit;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const map = {
      a: "link",
      button: "button",
      input: "textbox",
      select: "combobox",
      textarea: "textbox",
      label: "label",
    };
    return map[tag];
  }

  function nameOf(el) {
    if (!el || el.nodeType !== 1) return undefined;
    const labelledBy =
      el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean);
      if (parts.length) return parts.join(" ").slice(0, 200);
    }
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 200);
    if (el.labels && el.labels[0])
      return el.labels[0].textContent.trim().slice(0, 200);
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return label.textContent.trim().slice(0, 200);
    }
    const text = (el.innerText || el.textContent || "").trim();
    if (text && text.length < 120) return text;
    if (el.name) return el.name;
    if (el.placeholder) return el.placeholder;
    return undefined;
  }

  function labelOf(el) {
    const n = nameOf(el);
    if (n) return n;
    const role = roleOf(el);
    if (role) return role;
    if (el && el.tagName) return el.tagName.toLowerCase();
    return undefined;
  }

  function targetFromEvent(ev) {
    return resolveClickTarget(ev);
  }
`;
}
