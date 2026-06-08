import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchEventToSnapshotTarget,
  parseSnapshotJson,
  parseRefsFromSnapshotText,
} from "./snapshot-match.js";

describe("snapshot-match", () => {
  it("parses agent-browser snapshot JSON", () => {
    const stdout = `{"success":true,"data":{"origin":"http://localhost/invoices","refs":{"e1":{"role":"combobox","name":"Status"},"e2":{"role":"option","name":"Paid"}},"snapshot":"@e1 [combobox] \\"Status\\""}}`;
    const parsed = parseSnapshotJson(stdout);
    assert.ok(parsed);
    assert.equal(parsed.refs.e1?.role, "combobox");
    assert.equal(parsed.refs.e1?.name, "Status");
  });

  it("parses refs from snapshot text lines", () => {
    const refs = parseRefsFromSnapshotText(
      '@e3 [combobox] "Status"\n  @e4 [option] "Paid"',
    );
    assert.equal(refs.e3?.name, "Status");
    assert.equal(refs.e4?.role, "option");
  });

  it("matches click to the best snapshot ref", () => {
    const parsed = parseSnapshotJson(
      '{"success":true,"data":{"refs":{"e1":{"role":"combobox","name":"Status"},"e2":{"role":"combobox","name":"Sort By"},"e5":{"role":"option","name":"Pending payment"}},"snapshot":""}}',
    )!;
    const target = matchEventToSnapshotTarget(
      { role: "option", name: "Pending payment", label: "Pending payment" },
      parsed,
    );
    assert.equal(target?.ref, "e5");
    assert.equal(target?.description, '@e5 [option] "Pending payment"');
  });

  it("prefers combobox label over displayed value when names differ", () => {
    const parsed = parseSnapshotJson(
      '{"success":true,"data":{"refs":{"e1":{"role":"combobox","name":"Status"},"e2":{"role":"option","name":"Paid"}},"snapshot":""}}',
    )!;
    const target = matchEventToSnapshotTarget(
      { role: "combobox", name: "Paid", label: "Paid" },
      parsed,
    );
    assert.equal(target?.ref, "e1");
    assert.equal(target?.name, "Status");
  });

  it("returns undefined when match is ambiguous", () => {
    const parsed = parseSnapshotJson(
      '{"success":true,"data":{"refs":{"e1":{"role":"button","name":"Save"},"e2":{"role":"button","name":"Save"}},"snapshot":""}}',
    )!;
    assert.equal(
      matchEventToSnapshotTarget({ role: "button", name: "Save" }, parsed),
      undefined,
    );
  });
});
