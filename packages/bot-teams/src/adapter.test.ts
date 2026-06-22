import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityTypes } from "@microsoft/agents-activity";
import type { TurnContext } from "@microsoft/agents-hosting";
import { TeamsAdapter } from "./adapter.js";

/**
 * Regression coverage for the card-interaction auth fix.
 *
 * Adaptive Card `Action.Submit` clicks used to be handled on the inbound turn
 * context, whose connector client the M365 SDK builds with an anonymous
 * identity, so editing the card in place (`updateActivity`) was rejected 401
 * on real Teams. Credentialed interactions must instead run on the same
 * app-id-authenticated proactive (`continueConversation`) context as ordinary
 * replies. In the anonymous local Playground (no app id) the inbound context is
 * the only one available and is used directly.
 */
function cardClickContext(): TurnContext {
  const activity = {
    type: ActivityTypes.Message,
    value: { ckActionId: "ck:abc123", value: { confirmed: true } },
    conversation: { id: "conv-1" },
    from: { id: "user-1", name: "Tester" },
    replyToId: "card-activity-1",
    getConversationReference: () => ({
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.example/",
    }),
  };
  return { activity } as unknown as TurnContext;
}

function mockSink() {
  return {
    onTurn: vi.fn().mockResolvedValue(undefined),
    onCommand: vi.fn().mockResolvedValue(undefined),
    onInteraction: vi.fn().mockResolvedValue(undefined),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TeamsAdapter card interactions", () => {
  let prevClientId: string | undefined;
  beforeEach(() => {
    prevClientId = process.env.clientId;
    delete process.env.clientId;
  });
  afterEach(() => {
    if (prevClientId !== undefined) process.env.clientId = prevClientId;
  });

  it("routes the interaction through the authenticated proactive context when credentialed", async () => {
    const adapter = new TeamsAdapter({ clientId: "app-123" });
    const proactiveCtx = { id: "proactive" } as unknown as TurnContext;
    const continueConversation = vi.fn(
      async (
        _appId: string,
        _ref: unknown,
        cb: (c: TurnContext) => unknown,
      ) => {
        await cb(proactiveCtx);
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).cloud = { continueConversation };
    const sink = mockSink();
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(inbound, sink);
    await flush(); // the interaction runs on a detached proactive context

    expect(continueConversation).toHaveBeenCalledWith(
      "app-123",
      expect.anything(),
      expect.any(Function),
    );
    expect(sink.onInteraction).toHaveBeenCalledTimes(1);
    const evt = sink.onInteraction.mock.calls[0]![0];
    expect(evt.id).toBe("ck:abc123");
    expect(evt.value).toEqual({ confirmed: true });
    // The reply/edit context must be the proactive one, NOT the (anonymous)
    // inbound click context. That was the 401 bug.
    expect(evt.replyTarget.context).toBe(proactiveCtx);
    expect(evt.messageRef.context).toBe(proactiveCtx);
    expect(evt.messageRef.id).toBe("card-activity-1");
  });

  it("uses the inbound context for interactions in anonymous mode (no app id)", async () => {
    const adapter = new TeamsAdapter({});
    const continueConversation = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).cloud = { continueConversation };
    const sink = mockSink();
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(inbound, sink);
    await flush();

    expect(continueConversation).not.toHaveBeenCalled();
    expect(sink.onInteraction).toHaveBeenCalledTimes(1);
    const evt = sink.onInteraction.mock.calls[0]![0];
    expect(evt.replyTarget.context).toBe(inbound);
    expect(evt.messageRef.context).toBe(inbound);
  });
});
