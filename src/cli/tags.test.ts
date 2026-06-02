import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectAllTags, collectAnyTag, mergeTagFilters } from "./tags.js";

describe("tag CLI option parsing", () => {
  it("collects --tags values as AND groups", () => {
    const first = collectAllTags("smoke, checkout");
    const second = collectAllTags("auth", first);

    assert.deepEqual(second, [["smoke", "checkout"], ["auth"]]);
  });

  it("collects repeated --tag values as OR groups", () => {
    const first = collectAnyTag("smoke");
    const second = collectAnyTag("checkout", first);

    assert.deepEqual(second, [["smoke"], ["checkout"]]);
  });

  it("preserves negated tag terms", () => {
    assert.deepEqual(collectAllTags("p0,!smoke"), [["p0", "!smoke"]]);
    assert.deepEqual(collectAnyTag("!p0"), [["!p0"]]);
  });

  it("merges --tags and --tag filters into one expression", () => {
    assert.deepEqual(
      mergeTagFilters([["smoke", "checkout"]], [["auth"], ["billing"]]),
      [["smoke", "checkout"], ["auth"], ["billing"]],
    );
  });

  it("rejects empty tag filters", () => {
    assert.throws(() => collectAllTags(" , "), /at least one tag/);
    assert.throws(() => collectAnyTag(""), /at least one tag/);
  });

  it("rejects negation without a tag", () => {
    assert.throws(() => collectAllTags("p0,!"), /require a tag/);
    assert.throws(() => collectAnyTag("!"), /require a tag/);
  });
});
