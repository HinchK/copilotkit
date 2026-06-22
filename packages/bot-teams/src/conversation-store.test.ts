import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { TeamsConversationStore } from "./conversation-store.js";

/** Minimal stand-in: only the `messages` field the store writes is exercised. */
function makeAgent(threadId: string): AbstractAgent {
  return { threadId, messages: [] } as unknown as AbstractAgent;
}

describe("TeamsConversationStore", () => {
  it("seeds a fresh agent with the accumulated transcript", async () => {
    const store = new TeamsConversationStore();
    store.recordUser("conv-1", "hello");
    store.recordAssistant("conv-1", "hi there");
    store.recordUser("conv-1", "how are you?");

    const session = await store.getOrCreate("conv-1", {}, makeAgent);
    const messages = (session.agent as unknown as { messages: unknown[] })
      .messages;

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant", content: "hi there" }),
      expect.objectContaining({ role: "user", content: "how are you?" }),
    ]);
  });

  it("isolates transcripts by conversation key", async () => {
    const store = new TeamsConversationStore();
    store.recordUser("a", "from a");
    store.recordUser("b", "from b");

    const a = await store.getOrCreate("a", {}, makeAgent);
    const aMessages = (a.agent as unknown as { messages: unknown[] }).messages;
    expect(aMessages).toHaveLength(1);
    expect(aMessages[0]).toMatchObject({ content: "from a" });
  });

  it("exposes the transcript as bot-ui ThreadMessages", () => {
    const store = new TeamsConversationStore();
    store.recordUser("c", "ping");
    store.recordAssistant("c", "pong");
    expect(store.getTranscript("c")).toEqual([
      { text: "ping", isBot: false },
      { text: "pong", isBot: true },
    ]);
  });

  it("ignores empty messages", () => {
    const store = new TeamsConversationStore();
    store.recordUser("d", "");
    store.recordAssistant("d", "   "); // whitespace-only is still stored as-is by callers; empty string is dropped
    expect(store.getTranscript("d")).toEqual([{ text: "   ", isBot: true }]);
  });
});
