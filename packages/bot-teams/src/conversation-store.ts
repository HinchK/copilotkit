import { randomUUID } from "node:crypto";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ConversationStore,
  AgentSession,
  ReplyTarget,
} from "@copilotkit/bot";
import type { ThreadMessage } from "@copilotkit/bot-ui";

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * In-memory Teams conversation store.
 *
 * Unlike Slack, Teams does not hand the bot a free, queryable history of a
 * conversation, so the adapter keeps the transcript itself: the listener
 * records each incoming user message, and the run renderer records the agent's
 * reply. Each turn builds a fresh AG-UI thread id (the durable history is held
 * here, not server-side) and seeds the agent with the accumulated transcript.
 *
 * This is the batteries-included default. It is deliberately swappable: a
 * production deployment that needs the transcript to survive restarts can
 * implement {@link ConversationStore} against a real datastore and pass it in.
 */
export class TeamsConversationStore implements ConversationStore {
  private readonly history = new Map<string, StoredMessage[]>();

  /** Append a user message to the conversation transcript. */
  recordUser(conversationKey: string, content: string): void {
    if (!content) return;
    this.append(conversationKey, { id: randomUUID(), role: "user", content });
  }

  /** Append an assistant message to the conversation transcript. */
  recordAssistant(conversationKey: string, content: string): void {
    if (!content) return;
    this.append(conversationKey, {
      id: randomUUID(),
      role: "assistant",
      content,
    });
  }

  /** The accumulated transcript as bot-ui `ThreadMessage`s (backs `thread.getMessages()`). */
  getTranscript(conversationKey: string): ThreadMessage[] {
    const transcript = this.history.get(conversationKey) ?? [];
    return transcript.map((m) => ({
      text: m.content,
      isBot: m.role === "assistant",
    }));
  }

  private append(conversationKey: string, message: StoredMessage): void {
    const existing = this.history.get(conversationKey);
    if (existing) existing.push(message);
    else this.history.set(conversationKey, [message]);
  }

  async getOrCreate(
    conversationKey: string,
    _replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    // Fresh AG-UI thread per turn. Our `history` map is the durable record, so
    // the server-side thread only needs to live for this turn (mirrors the
    // Slack adapter's rationale for not reusing a stable thread id).
    const threadId = `teams-${conversationKey}-${randomUUID()}`;
    const agent = makeAgent(threadId);
    const transcript = this.history.get(conversationKey) ?? [];
    (agent as unknown as { messages: StoredMessage[] }).messages = [
      ...transcript,
    ];
    return { agent };
  }
}
