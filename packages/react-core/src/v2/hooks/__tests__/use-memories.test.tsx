import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import type { ɵMemoryStore } from "@copilotkit/core";
import { useMemories } from "../use-memories";

vi.mock("../../context", () => ({ useCopilotKit: vi.fn() }));
const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

let registered: Record<string, ɵMemoryStore>;
beforeEach(() => {
  registered = {};
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl: "https://runtime.test",
      headers: {},
      registerMemoryStore: (agentId: string, store: ɵMemoryStore) => {
        registered[agentId] = store;
      },
      unregisterMemoryStore: (agentId: string) => {
        delete registered[agentId];
      },
    },
  });
});

describe("useMemories", () => {
  it("starts with an empty list and not loading", () => {
    const { result } = renderHook(() => useMemories({ agentId: "agent-1" }));
    expect(result.current.memories).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("addMemory inserts and the list reflects it", async () => {
    const { result } = renderHook(() => useMemories({ agentId: "agent-1" }));
    await act(async () => {
      await result.current.addMemory({
        kind: "topical",
        scope: "user",
        content: "likes dark mode",
      });
    });
    await waitFor(() =>
      expect(result.current.memories.map((m) => m.content)).toEqual([
        "likes dark mode",
      ]),
    );
  });

  it("updateMemory supersedes: the row gets a new id", async () => {
    const { result } = renderHook(() => useMemories({ agentId: "agent-1" }));
    let createdId = "";
    await act(async () => {
      const created = await result.current.addMemory({
        kind: "topical",
        scope: "user",
        content: "v1",
      });
      createdId = created.id;
    });
    await act(async () => {
      await result.current.updateMemory(createdId, { content: "v2" });
    });
    await waitFor(() => {
      const ids = result.current.memories.map((m) => m.id);
      expect(ids).not.toContain(createdId);
      expect(result.current.memories.map((m) => m.content)).toEqual(["v2"]);
    });
  });

  it("reflects an externally emitted realtime created event", async () => {
    const { result } = renderHook(() => useMemories({ agentId: "agent-1" }));
    act(() => {
      (registered["agent-1"] as any).ɵemitMetadataEvent({
        operation: "created",
        memory: {
          id: "ext-1",
          kind: "episodic",
          scope: "user",
          content: "from another client",
          sourceThreadIds: [],
          invalidatedAt: null,
        },
      });
    });
    await waitFor(() =>
      expect(result.current.memories.map((m) => m.id)).toContain("ext-1"),
    );
  });

  it("filters by scope when scope is provided", async () => {
    const { result } = renderHook(() =>
      useMemories({ agentId: "agent-1", scope: "user" }),
    );
    await act(async () => {
      await result.current.addMemory({
        kind: "operational",
        scope: "project",
        content: "project memo",
      });
      await result.current.addMemory({
        kind: "topical",
        scope: "user",
        content: "user pref",
      });
    });
    await waitFor(() =>
      expect(result.current.memories.map((m) => m.content)).toEqual([
        "user pref",
      ]),
    );
  });
});
