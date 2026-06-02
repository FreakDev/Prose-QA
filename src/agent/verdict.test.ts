import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage } from "ai";
import type { AgentTranscript } from "../types/verdict.js";
import {
  appendFinalTextToTranscript,
  appendStepToTranscript,
  formatStepForTranscript,
  stripLastAssistantTurn,
} from "./verdict.js";

describe("stripLastAssistantTurn", () => {
  it("removes the last assistant message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "no verdict yet" },
    ];
    assert.deepEqual(stripLastAssistantTurn(messages), [
      { role: "user", content: "go" },
    ]);
  });

  it("removes trailing tool results with the assistant turn", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "bash",
            input: { command: "true" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "1",
            toolName: "bash",
            output: { type: "json", value: { exitCode: 0 } },
          },
        ],
      },
    ];
    assert.deepEqual(stripLastAssistantTurn(messages), [
      { role: "user", content: "go" },
    ]);
  });
});

describe("formatStepForTranscript", () => {
  it("returns empty content when the step has no text, reasoning, or tool calls", () => {
    assert.deepEqual(formatStepForTranscript({ text: "", toolCalls: [] }), {
      content: null,
    });
  });

  it("includes assistant text in content", () => {
    assert.deepEqual(
      formatStepForTranscript({
        text: "Opening the app.",
        toolCalls: [],
      }),
      { content: "Opening the app." },
    );
  });

  it("includes tool calls in content when the step has no assistant text", () => {
    assert.deepEqual(
      formatStepForTranscript({
        text: "",
        toolCalls: [{ toolName: "bash", input: { command: "agent-browser open /" } }],
      }),
      {
        content: '[tool bash] {"command":"agent-browser open /"}',
      },
    );
  });

  it("keeps text and tool calls in content and reasoning in thinking", () => {
    assert.deepEqual(
      formatStepForTranscript({
        text: "Checking the page.",
        reasoningText: "Need a snapshot first.",
        toolCalls: [{ toolName: "bash", input: { command: "agent-browser snapshot -i" } }],
      }),
      {
        content: [
          "Checking the page.",
          '[tool bash] {"command":"agent-browser snapshot -i"}',
        ].join("\n\n"),
        thinking: "Need a snapshot first.",
      },
    );
  });
});

describe("appendFinalTextToTranscript", () => {
  it("skips append only when the last assistant message exactly matches finalText", () => {
    const transcript = {
      entries: [
        { type: "message" as const, role: "assistant", content: "The test passed successfully", at: "2026-01-01T00:00:00.000Z" },
      ],
    };

    appendFinalTextToTranscript(transcript, "passed");
    assert.equal(transcript.entries.length, 2);
    assert.equal(
      transcript.entries[1]!.type === "message" ? transcript.entries[1]!.content : "",
      "passed",
    );
  });

  it("does not append duplicate when finalText equals the last assistant message", () => {
    const transcript = {
      entries: [{ type: "message" as const, role: "assistant", content: "Done.", at: "2026-01-01T00:00:00.000Z" }],
    };

    appendFinalTextToTranscript(transcript, "Done.");
    assert.equal(transcript.entries.length, 1);
  });
});

describe("appendStepToTranscript", () => {
  it("appends one assistant message per step", () => {
    const transcript: AgentTranscript = { entries: [] };

    assert.equal(
      appendStepToTranscript(transcript, {
        text: "",
        toolCalls: [{ toolName: "bash", input: { command: "agent-browser open /" } }],
      }),
      true,
    );
    assert.equal(
      appendStepToTranscript(transcript, {
        text: "Done.",
        toolCalls: [],
      }),
      true,
    );

    assert.equal(transcript.entries.length, 2);
    const first = transcript.entries[0]!;
    const second = transcript.entries[1]!;
    assert.equal(first.type, "message");
    assert.equal(first.role, "assistant");
    assert.match(first.content, /agent-browser open/);
    assert.ok(first.at);
    assert.equal(second.type, "message");
    assert.equal(second.content, "Done.");
    assert.ok(second.at);
  });

  it("records timestamps and LLM step duration on assistant messages", () => {
    const transcript: AgentTranscript = { entries: [] };
    const at = new Date("2026-01-01T00:00:05.000Z");

    appendStepToTranscript(
      transcript,
      { text: "Checking.", toolCalls: [] },
      [],
      undefined,
      { at, durationMs: 4200 },
    );

    assert.equal(transcript.entries.length, 1);
    const message = transcript.entries[0]!;
    assert.equal(message.type, "message");
    assert.equal(message.at, "2026-01-01T00:00:05.000Z");
    assert.equal(message.durationMs, 4200);
  });

  it("writes the assistant message before bash results for a step", () => {
    const transcript: AgentTranscript = { entries: [] };

    appendStepToTranscript(
      transcript,
      {
        text: "Opening the app.",
        reasoningText: "Need to load the page first.",
        toolCalls: [{ toolName: "bash", input: { command: "agent-browser open /" } }],
      },
      [
        {
          command: "agent-browser open /",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 10,
        },
      ],
    );

    assert.equal(transcript.entries.length, 2);
    const message = transcript.entries[0]!;
    const bash = transcript.entries[1]!;
    assert.equal(message.type, "message");
    assert.equal(bash.type, "bash");
    assert.match(message.content, /Opening the app/);
    assert.equal(message.thinking, "Need to load the page first.");
    assert.equal(message.at, bash.at);
    assert.equal(bash.command, "agent-browser open /");
  });
});
