import { describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import { injectMemories } from "./memories";

const setup = () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotKit({})],
  });
  const copilotkit = TestBed.inject(CopilotKit);
  return { copilotkit };
};

describe("injectMemories", () => {
  it("starts empty and registers the store on core", () => {
    const { copilotkit } = setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1" }),
    );
    expect(controller.memories()).toEqual([]);
    expect(copilotkit.core.getMemoryStore("agent-1")).toBeDefined();
  });

  it("addMemory updates the memories signal", async () => {
    setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1" }),
    );
    await controller.addMemory({
      kind: "topical",
      scope: "user",
      content: "likes dark mode",
    });
    expect(controller.memories().map((m) => m.content)).toEqual([
      "likes dark mode",
    ]);
  });

  it("updateMemory supersedes with a new id", async () => {
    setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1" }),
    );
    const created = await controller.addMemory({
      kind: "topical",
      scope: "user",
      content: "v1",
    });
    await controller.updateMemory(created.id, { content: "v2" });
    const ids = controller.memories().map((m) => m.id);
    expect(ids).not.toContain(created.id);
    expect(controller.memories().map((m) => m.content)).toEqual(["v2"]);
  });

  it("filters by scope", async () => {
    setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1", scope: "user" }),
    );
    await controller.addMemory({
      kind: "operational",
      scope: "project",
      content: "project memo",
    });
    await controller.addMemory({
      kind: "topical",
      scope: "user",
      content: "user pref",
    });
    expect(controller.memories().map((m) => m.content)).toEqual(["user pref"]);
  });

  it("excludes invalidated memories by default", async () => {
    const { copilotkit } = setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1" }),
    );

    // A normal (non-invalidated) memory must be visible in both branches.
    await controller.addMemory({
      kind: "topical",
      scope: "user",
      content: "live fact",
    });

    // Simulate a retired memory arriving via the realtime seam.
    const store = copilotkit.core.getMemoryStore("agent-1") as unknown as {
      ɵemitMetadataEvent: (e: unknown) => void;
    };
    store.ɵemitMetadataEvent({
      operation: "created",
      memory: {
        id: "retired-1",
        kind: "topical",
        scope: "user",
        content: "old fact",
        sourceThreadIds: [],
        invalidatedAt: "2026-01-01T00:00:00Z",
      },
    });

    const ids = controller.memories().map((m) => m.id);
    expect(ids).not.toContain("retired-1");
    expect(controller.memories().map((m) => m.content)).toContain("live fact");
  });

  it("includes invalidated memories when includeInvalidated is true", async () => {
    const { copilotkit } = setup();
    const controller = TestBed.runInInjectionContext(() =>
      injectMemories({ agentId: "agent-1", includeInvalidated: true }),
    );

    // A normal (non-invalidated) memory must also be visible.
    await controller.addMemory({
      kind: "topical",
      scope: "user",
      content: "live fact",
    });

    // Same retired memory as the previous test.
    const store = copilotkit.core.getMemoryStore("agent-1") as unknown as {
      ɵemitMetadataEvent: (e: unknown) => void;
    };
    store.ɵemitMetadataEvent({
      operation: "created",
      memory: {
        id: "retired-1",
        kind: "topical",
        scope: "user",
        content: "old fact",
        sourceThreadIds: [],
        invalidatedAt: "2026-01-01T00:00:00Z",
      },
    });

    const ids = controller.memories().map((m) => m.id);
    expect(ids).toContain("retired-1");
    expect(controller.memories().map((m) => m.content)).toContain("live fact");
  });
});
