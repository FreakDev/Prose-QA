import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { persistTranscript } from "./transcript-persist.js";

describe("persistTranscript", () => {
  it("writes transcript.json to the artifact directory", () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "pqa-persist-"));
    const transcript = {
      entries: [
        {
          type: "message" as const,
          role: "user",
          content: "Run the scenario.",
          at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    persistTranscript({ artifactDir }, transcript);

    const filePath = path.join(artifactDir, "transcript.json");
    assert.equal(existsSync(filePath), true);
    const written = JSON.parse(readFileSync(filePath, "utf8")) as typeof transcript;
    assert.deepEqual(written, transcript);
  });

  it("overwrites transcript.json on each call so disk stays in sync", () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "pqa-persist-"));
    const first = {
      entries: [
        {
          type: "message" as const,
          role: "user",
          content: "First message.",
          at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const second = {
      entries: [
        ...first.entries,
        {
          type: "message" as const,
          role: "assistant",
          content: "Working on it.",
          at: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    persistTranscript({ artifactDir }, first);
    persistTranscript({ artifactDir }, second);

    const written = JSON.parse(
      readFileSync(path.join(artifactDir, "transcript.json"), "utf8"),
    ) as typeof second;
    assert.equal(written.entries.length, 2);
    assert.equal(
      written.entries[1]!.type === "message" ? written.entries[1]!.content : "",
      "Working on it.",
    );
  });
});
