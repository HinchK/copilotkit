import { useCopilotKit } from "../context";
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
  ɵMemoryStore,
} from "@copilotkit/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/** Configuration for {@link useMemories}. */
export interface UseMemoriesInput {
  /** Agent whose memories to list and manage. */
  agentId: string;
  /** When set, only memories of this scope are returned. Omit for both. */
  scope?: MemoryScope;
  /** When `true`, retired (invalidated) memories are included. */
  includeInvalidated?: boolean;
}

/** Return value of {@link useMemories}. */
export interface UseMemoriesResult {
  memories: PublicMemory[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  addMemory: (input: NewMemory) => Promise<PublicMemory>;
  /** Supersede: resolves to the new memory (new id). Key lists on `memory.id`. */
  updateMemory: (id: string, changes: MemoryChanges) => Promise<PublicMemory>;
  removeMemory: (id: string) => Promise<void>;
}

function useMemoryStoreSelector<T>(
  store: ɵMemoryStore,
  selector: (state: ReturnType<ɵMemoryStore["getState"]>) => T,
): T {
  return useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const subscription = store.select(selector).subscribe(onStoreChange);
        return () => subscription.unsubscribe();
      },
      [store, selector],
    ),
    () => selector(store.getState()),
  );
}

/**
 * React hook for listing and managing a user/agent's memories. Subscribes to
 * the core memory store and exposes its live list plus stable mutation
 * callbacks. `updateMemory` is a supersede — it resolves to a new memory whose
 * `id` differs from the input id, so list rows must be keyed on `memory.id`.
 *
 * @example
 * ```tsx
 * const { memories, addMemory, updateMemory, removeMemory } =
 *   useMemories({ agentId: "agent-1" });
 * ```
 */
export function useMemories({
  agentId,
  scope,
  includeInvalidated,
}: UseMemoriesInput): UseMemoriesResult {
  const { copilotkit } = useCopilotKit();

  const [store] = useState(() =>
    // bound to its receiver so the (eventual transport-backed) store can invoke it safely
    ɵcreateMemoryStore({ fetch: globalThis.fetch.bind(globalThis) }),
  );

  const allMemories = useMemoryStoreSelector(store, ɵselectMemories);
  const isLoading = useMemoryStoreSelector(store, ɵselectMemoriesIsLoading);
  const error = useMemoryStoreSelector(store, ɵselectMemoriesError);

  const memories = useMemo(
    () =>
      allMemories.filter((memory) => {
        if (scope && memory.scope !== scope) return false;
        if (!includeInvalidated && memory.invalidatedAt) return false;
        return true;
      }),
    [allMemories, scope, includeInvalidated],
  );

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  useEffect(() => {
    copilotkit.registerMemoryStore(agentId, store);
    return () => copilotkit.unregisterMemoryStore(agentId);
  }, [copilotkit, agentId, store]);

  // TODO(RD-34 integration): dispatch runtime context + gate on
  // runtimeConnectionStatus the way useThreads does, once the transport-backed
  // store replaces the in-memory mock.

  const refresh = useCallback(() => store.refresh(), [store]);
  const addMemory = useCallback(
    (input: NewMemory) => store.addMemory(input),
    [store],
  );
  const updateMemory = useCallback(
    (id: string, changes: MemoryChanges) => store.updateMemory(id, changes),
    [store],
  );
  const removeMemory = useCallback(
    (id: string) => store.removeMemory(id),
    [store],
  );

  return {
    memories,
    isLoading,
    error,
    refresh,
    addMemory,
    updateMemory,
    removeMemory,
  };
}
