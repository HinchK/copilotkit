import { DestroyRef, Signal, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { CopilotKit } from "./copilotkit";
import {
  ɵcreateMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
} from "@copilotkit/core";
import type {
  MemoryChanges,
  MemoryScope,
  NewMemory,
  PublicMemory,
} from "@copilotkit/core";

/** Parameters for {@link injectMemories}. */
export interface InjectMemoriesParams {
  agentId: string;
  scope?: MemoryScope;
  includeInvalidated?: boolean;
}

/** Reactive controller returned by {@link injectMemories}. */
export interface MemoriesController {
  memories: Signal<PublicMemory[]>;
  isLoading: Signal<boolean>;
  error: Signal<Error | null>;
  refresh(): Promise<void>;
  addMemory(input: NewMemory): Promise<PublicMemory>;
  /** Supersede: resolves to the new memory (new id). Use `track m.id`. */
  updateMemory(id: string, changes: MemoryChanges): Promise<PublicMemory>;
  removeMemory(id: string): Promise<void>;
}

/**
 * Angular binding for a user/agent's memories — the analog of the React
 * `useMemories` hook, exposing live state as signals. Must be called in an
 * injection context (constructor or field initializer of a
 * standalone/injectable). Cleans up (stops + unregisters the store) on destroy.
 *
 * @example
 * ```ts
 * readonly memories = injectMemories({ agentId: "agent-1" });
 * // template: @for (m of memories.memories(); track m.id) { ... }
 * ```
 */
export function injectMemories(
  params: InjectMemoriesParams,
): MemoriesController {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  const { agentId, scope, includeInvalidated } = params;

  // Bind to globalThis so the eventual transport-backed store can invoke it
  // safely regardless of how it is called internally (no behavior change today
  // as the mock ignores fetch).
  const store = ɵcreateMemoryStore({
    fetch: globalThis.fetch.bind(globalThis),
  });
  copilotkit.core.registerMemoryStore(agentId, store);
  store.start();

  // Register cleanup immediately after start so teardown is guaranteed even if
  // any of the bridge setup below throws.
  destroyRef.onDestroy(() => {
    store.stop();
    copilotkit.core.unregisterMemoryStore(agentId);
  });

  // TODO(RD-34 integration): dispatch runtime context + gate on
  // runtimeConnectionStatus once the transport-backed store lands.

  const allMemories = toSignal(store.select(ɵselectMemories), {
    initialValue: store.getState().memories,
  });
  const isLoading = toSignal(store.select(ɵselectMemoriesIsLoading), {
    initialValue: store.getState().isLoading,
  });
  const error = toSignal(store.select(ɵselectMemoriesError), {
    initialValue: store.getState().error,
  });

  const memories = computed(() =>
    allMemories().filter((memory) => {
      if (scope && memory.scope !== scope) return false;
      if (!includeInvalidated && memory.invalidatedAt) return false;
      return true;
    }),
  );

  return {
    memories,
    isLoading,
    error,
    refresh: () => store.refresh(),
    addMemory: (input) => store.addMemory(input),
    updateMemory: (id, changes) => store.updateMemory(id, changes),
    removeMemory: (id) => store.removeMemory(id),
  };
}
