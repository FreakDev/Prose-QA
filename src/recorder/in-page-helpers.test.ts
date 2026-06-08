import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";
import { buildInPageRecorderHelpers } from "./in-page-helpers.js";

type MockRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type MockEl = {
  nodeType: number;
  tagName: string;
  type?: string;
  parentElement: MockEl | null;
  textContent?: string;
  innerText?: string;
  labels?: { textContent: string }[];
  id?: string;
  name?: string;
  placeholder?: string;
  isContentEditable?: boolean;
  getAttribute: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  parentElementSetter?: MockEl | null;
};

function el(
  tag: string,
  opts: {
    role?: string;
    parent?: MockEl | null;
    text?: string;
    type?: string;
    tabindex?: string;
    ariaHidden?: boolean;
    id?: string;
  } = {},
): MockEl {
  const node: MockEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    type: opts.type,
    parentElement: opts.parent ?? null,
    textContent: opts.text,
    innerText: opts.text,
    id: opts.id,
    getAttribute(name: string) {
      if (name === "role") return opts.role ?? null;
      if (name === "tabindex") return opts.tabindex ?? null;
      if (name === "aria-hidden") return opts.ariaHidden ? "true" : null;
      return null;
    },
    hasAttribute(name: string) {
      return name === "href" && tag === "a";
    },
  };
  return node;
}

function chain(...nodes: MockEl[]): MockEl {
  const first = nodes[0];
  if (!first) throw new Error("chain requires at least one node");
  for (let i = 0; i < nodes.length - 1; i++) {
    const current = nodes[i];
    const parent = nodes[i + 1];
    if (current && parent) current.parentElement = parent;
  }
  return first;
}

function loadHelpers(
  document: Record<string, unknown>,
): {
  resolveClickTarget: (ev: {
    target: MockEl | null;
    clientX: number;
    clientY: number;
    composedPath: () => MockEl[];
  }) => MockEl | null;
  roleOf: (el: MockEl) => string | undefined;
  nameOf: (el: MockEl) => string | undefined;
} {
  const ctx = createContext({
    document,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      pointerEvents: "auto",
    }),
  });
  runInContext(buildInPageRecorderHelpers(), ctx);
  return ctx as never;
}

describe("in-page recorder target resolution", () => {
  it("resolves body target via elementFromPoint to interactive ancestor", () => {
    const body = el("body");
    const wrapper = el("div", { parent: body });
    const button = el("button", { parent: wrapper, text: "Filter" });
    chain(button, wrapper, body);

    const helpers = loadHelpers({
      body,
      documentElement: el("html"),
      elementFromPoint: () => button,
      getElementById: () => null,
      querySelector: () => null,
    });

    const resolved = helpers.resolveClickTarget({
      target: body,
      clientX: 10,
      clientY: 10,
      composedPath: () => [body, wrapper, button],
    });

    assert.equal(resolved, button);
    assert.equal(helpers.roleOf(button), "button");
    assert.equal(helpers.nameOf(button), "Filter");
  });

  it("walks composedPath to first snapshot-interactive element", () => {
    const body = el("body");
    const helpers = loadHelpers({
      body,
      documentElement: el("html"),
      elementFromPoint: () => null,
      getElementById: () => null,
      querySelector: () => null,
    });
    const span = el("span", { parent: body, text: "Paid" });
    const option = el("li", { parent: body, role: "option", text: "Paid" });
    chain(span, option, body);

    const resolved = helpers.resolveClickTarget({
      target: span,
      clientX: 0,
      clientY: 0,
      composedPath: () => [span, option, body],
    });

    assert.equal(resolved, option);
    assert.equal(helpers.roleOf(option), "option");
  });

  it("finds combobox sibling when click lands on a non-interactive wrapper (MUI Select)", () => {
    const body = el("body");
    const formControl = el("div", { parent: body });
    const inputBase = el("div", { parent: formControl });
    const outline = el("div", { parent: inputBase });
    const combobox = el("div", {
      parent: inputBase,
      role: "combobox",
      text: "Status",
      tabindex: "0",
    });
    chain(outline, inputBase, formControl, body);

    const helpers = loadHelpers({
      body,
      documentElement: el("html"),
      elementFromPoint: () => outline,
      getElementById: () => null,
      querySelector: () => null,
    });

    (combobox as MockEl & { getBoundingClientRect: () => MockRect }).getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 });
    (outline as MockEl & { getBoundingClientRect: () => MockRect }).getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 });
    const withQuery = (node: MockEl) => {
      (node as MockEl & { querySelectorAll: () => MockEl[] }).querySelectorAll =
        () => [combobox];
    };
    withQuery(inputBase);
    withQuery(formControl);

    const resolved = helpers.resolveClickTarget({
      target: outline,
      clientX: 50,
      clientY: 15,
      composedPath: () => [outline, inputBase, formControl, body],
    });

    assert.equal(resolved, combobox);
    assert.equal(helpers.roleOf(combobox), "combobox");
  });

  it("finds combobox when click is on a sibling icon (MUI Select chevron)", () => {
    const body = el("body");
    const inputBase = el("div", { parent: body });
    const combobox = el("div", {
      parent: inputBase,
      role: "combobox",
      text: "All",
      tabindex: "0",
    });
    const icon = el("div", { parent: inputBase });
    chain(icon, inputBase, body);

    const helpers = loadHelpers({
      body,
      documentElement: el("html"),
      elementFromPoint: () => icon,
      getElementById: () => null,
      querySelector: () => null,
    });

    (combobox as MockEl & { getBoundingClientRect: () => MockRect }).getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 80, bottom: 30, width: 80, height: 30 });
    (icon as MockEl & { getBoundingClientRect: () => MockRect }).getBoundingClientRect =
      () => ({ left: 200, top: 0, right: 230, bottom: 30, width: 30, height: 30 });
    (inputBase as MockEl & {
      querySelector: (sel: string) => MockEl | null;
      querySelectorAll: () => MockEl[];
    }).querySelector = (sel: string) =>
      sel.includes("combobox") ? combobox : null;
    (inputBase as MockEl & { querySelectorAll: () => MockEl[] }).querySelectorAll =
      () => [combobox];

    const resolved = helpers.resolveClickTarget({
      target: icon,
      clientX: 210,
      clientY: 15,
      composedPath: () => [icon, inputBase, body],
    });

    assert.equal(resolved, combobox);
  });

  it("returns null when only body/html is clicked with no interactive target", () => {
    const body = el("body");
    const helpers = loadHelpers({
      body,
      documentElement: el("html"),
      elementFromPoint: () => null,
      getElementById: () => null,
      querySelector: () => null,
    });
    const resolved = helpers.resolveClickTarget({
      target: body,
      clientX: 0,
      clientY: 0,
      composedPath: () => [body],
    });
    assert.equal(resolved, null);
  });
});
