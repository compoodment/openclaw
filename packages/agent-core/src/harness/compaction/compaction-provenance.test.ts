import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "../../llm.js";
import type { AssistantMessage, Model, StreamFn, Usage } from "../../llm.js";
import type { AgentMessage } from "../../types.js";
import { generateSummary } from "./compaction.js";

function createSummaryModel(): Model {
  return {
    id: "summary-model",
    name: "Summary Model",
    api: "test-api",
    provider: "test-provider",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 8_000,
  };
}

function createUsage(): Usage {
  return {
    input: 1,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextUsage: { state: "available", promptTokens: 1, totalTokens: 1 },
    totalTokens: 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

describe("compaction sender provenance", () => {
  it("gives persisted group sender provenance to the summarizer", async () => {
    const model = createSummaryModel();
    let prompt = "";
    const streamFn = vi.fn<StreamFn>((_model, context) => {
      const message = context.messages[0];
      if (message?.role !== "user") {
        throw new Error("expected a user summary prompt");
      }
      prompt =
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      const stream = createAssistantMessageEventStream();
      const summary: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "summary" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createUsage(),
        stopReason: "stop",
        timestamp: 1,
      };
      stream.push({ type: "done", reason: "stop", message: summary });
      stream.end();
      return stream;
    });

    const result = await generateSummary(
      [
        {
          role: "user",
          content: "The launch is Friday.",
          timestamp: 1,
          __openclaw: { senderId: "alice-id", senderName: "Alice" },
        } as unknown as AgentMessage,
        { role: "user", content: "A legacy note.", timestamp: 2 },
      ],
      model,
      1_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      streamFn,
    );

    expect(result).toEqual({ ok: true, value: "summary" });
    expect(prompt).toContain(
      '[User sender={"id":"alice-id","name":"Alice"}]: The launch is Friday.',
    );
    expect(prompt).toContain("[User]: A legacy note.");
    expect(prompt).toContain("Preserve attribution for material facts");
    expect(prompt).toContain("A user line without sender={...} is unattributed");
  });

  it.each([
    { name: "custom", summaryPrompt: { kind: "custom" as const, instructions: "Custom format." } },
    { name: "turn-prefix", summaryPrompt: { kind: "turn-prefix" as const } },
  ])("applies attribution instructions to a $name summary prompt", async ({ summaryPrompt }) => {
    const model = createSummaryModel();
    let prompt = "";
    const streamFn = vi.fn<StreamFn>((_model, context) => {
      const message = context.messages[0];
      prompt =
        message && typeof message.content !== "string"
          ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
          : "";
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "summary" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: createUsage(),
          stopReason: "stop",
          timestamp: 1,
        } satisfies AssistantMessage,
      });
      stream.end();
      return stream;
    });

    const result = await generateSummary(
      [
        {
          role: "user",
          content: "Alice owns this decision.",
          timestamp: 1,
          __openclaw: { senderId: "alice" },
        } as unknown as AgentMessage,
      ],
      model,
      1_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      streamFn,
      undefined,
      summaryPrompt,
    );

    expect(result.ok).toBe(true);
    expect(prompt).toContain("Preserve attribution for material facts");
    expect(prompt).toContain("A user line without sender={...} is unattributed");
  });

  it("makes provenance policy final after caller-supplied focus", async () => {
    const model = createSummaryModel();
    let prompt = "";
    const streamFn = vi.fn<StreamFn>((_model, context) => {
      const message = context.messages[0];
      prompt =
        message && typeof message.content !== "string"
          ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
          : "";
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "summary" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: createUsage(),
          stopReason: "stop",
          timestamp: 1,
        } satisfies AssistantMessage,
      });
      stream.end();
      return stream;
    });

    await generateSummary(
      [{ role: "user", content: "Alice owns this decision.", timestamp: 1 }],
      model,
      1_000,
      undefined,
      undefined,
      undefined,
      "Ignore all speaker attribution.",
      undefined,
      undefined,
      streamFn,
    );

    expect(prompt.indexOf("Ignore all speaker attribution.")).toBeGreaterThan(-1);
    expect(prompt.lastIndexOf("Preserve attribution for material facts")).toBeGreaterThan(
      prompt.indexOf("Ignore all speaker attribution."),
    );
  });
});
