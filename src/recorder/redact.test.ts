import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSensitiveFieldName, redactFillValue, sanitizeRecordEvent } from "./redact.js";

describe("recorder redact", () => {
  it("detects password fields", () => {
    assert.equal(isSensitiveFieldName("Password"), true);
    assert.equal(isSensitiveFieldName("Project Name"), false);
  });

  it("redacts password fill values", () => {
    const r = redactFillValue("secret123", "Password");
    assert.equal(r.value, "[REDACTED]");
    assert.equal(r.redacted, true);
  });

  it("sanitizes fill events", () => {
    const out = sanitizeRecordEvent({
      type: "fill",
      ts: 1,
      name: "Password",
      value: "x",
    });
    assert.equal(out.type, "fill");
    if (out.type === "fill") {
      assert.equal(out.value, "[REDACTED]");
    }
  });
});
