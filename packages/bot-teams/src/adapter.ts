import {
  CloudAdapter,
  CardFactory,
  MessageFactory,
} from "@microsoft/agents-hosting";
import type { AuthConfiguration, TurnContext } from "@microsoft/agents-hosting";
import { ActivityTypes, Activity } from "@microsoft/agents-activity";
import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget,
  ConversationStore,
  MessageRef,
  PlatformUser,
  UserQuery,
} from "@copilotkit/bot";
import type { BotNode, ThreadMessage } from "@copilotkit/bot-ui";
import type { ConversationReference } from "@microsoft/agents-activity";
import { TeamsConversationStore } from "./conversation-store.js";
import { createTeamsServer } from "./listener.js";
import type { TeamsServer } from "./listener.js";
import { conversationKeyOf, parseCardAction } from "./interaction.js";
import { createRunRenderer } from "./event-renderer.js";
import { renderTeamsMarkdown } from "./render/markdown.js";
import { renderAdaptiveCard, isPlainText } from "./render/adaptive-card.js";
import type { AdaptiveCard } from "./render/adaptive-card.js";
import { TeamsMessageStream } from "./message-stream.js";
import type { TeamsAdapterOptions, TeamsReplyTarget } from "./types.js";

/** Native render output: a plain text activity or an Adaptive Card attachment. */
type TeamsActivityPayload = { text: string } | { card: AdaptiveCard };

/**
 * A Teams `MessageRef`. `context` is a live turn context when one is in scope;
 * `reference` lets `update`/`delete` re-enter the conversation out-of-turn (via
 * `continueConversation`) when it isn't, e.g. editing a picker card after the
 * agent run that posted it has detached from its inbound turn.
 */
interface TeamsMessageRef extends MessageRef {
  conversationKey: string;
  context?: TurnContext;
  reference?: Partial<ConversationReference>;
}

/**
 * Microsoft Teams `PlatformAdapter`.
 *
 * Ingress: a `CloudAdapter` receives Teams activities at `POST /api/messages`
 * (M365 Agents SDK). The inbound HTTP turn is **acked immediately**; the agent
 * run is handed off to a detached `continueConversation` so it can outlive the
 * turn. This is required for HITL, where `awaitChoice` suspends the run until a user
 * clicks an Adaptive Card button (possibly minutes later). That detached
 * `continueConversation` provides a stable `TurnContext` the whole run streams
 * on, exactly as the Slack adapter runs in the background off a web client.
 *
 * Adaptive Card `Action.Submit` clicks arrive as Message activities carrying
 * the action `data` in `activity.value`; those are decoded and routed to
 * `sink.onInteraction` to resolve the waiter. This path needs no Microsoft
 * credentials in the local M365 Agents Playground.
 */
export class TeamsAdapter implements PlatformAdapter {
  readonly platform = "teams";
  readonly capabilities: SurfaceCapabilities;
  // Teams keeps the inbound HTTP turn open while the bot works; ~15s is the
  // practical channel window. Declarative today (the engine doesn't enforce it).
  readonly ackDeadlineMs = 15000;

  private readonly store = new TeamsConversationStore();
  private cloud: CloudAdapter | undefined;
  private server: TeamsServer | undefined;
  private sink: IngressSink | undefined;

  constructor(private readonly opts: TeamsAdapterOptions = {}) {
    this.capabilities = {
      supportsModals: false,
      supportsTyping: true,
      supportsReactions: false,
      // Streamed by message edit (post-then-updateActivity), not native
      // token-by-token streaming, but the engine's streaming path is honored.
      supportsStreaming: true,
    };
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;

    const authConfig: AuthConfiguration = {
      clientId: this.opts.clientId ?? process.env.clientId,
      clientSecret: this.opts.clientSecret ?? process.env.clientSecret,
      tenantId: this.opts.tenantId ?? process.env.tenantId,
    };
    this.cloud = new CloudAdapter(authConfig);
    // Contain turn-handler failures at the SDK boundary. Without this the M365
    // adapter rethrows (e.g. a Bot Connector 401 surfaces as "Unknown error
    // type"), which becomes an unhandled rejection and crashes the process,
    // turning one bad turn into a service-wide outage + restart loop.
    this.cloud.onTurnError = async (_context, error) => {
      console.error("[bot-teams] turn error:", error);
    };

    this.server = createTeamsServer({
      adapter: this.cloud,
      port: this.opts.port ?? 3978,
      onTurnContext: (context) => this.handleActivity(context, sink),
    });
    await this.server.start();
  }

  async stop(): Promise<void> {
    await this.server?.stop();
  }

  /**
   * Normalize an inbound activity, ack the HTTP turn immediately, and drive the
   * work into the engine on a **detached** `continueConversation` so it can
   * outlive this turn (HITL suspends the run until a later click).
   */
  private async handleActivity(
    context: TurnContext,
    sink: IngressSink,
  ): Promise<void> {
    const activity = context.activity;
    if (activity.type !== ActivityTypes.Message) return;

    const conversationKey = conversationKeyOf(activity);
    const reference = activity.getConversationReference();
    const from = activity.from;
    const user: PlatformUser | undefined = from?.id
      ? { id: from.id, name: from.name }
      : undefined;

    // An Adaptive Card `Action.Submit` arrives as a Message activity carrying
    // our action `data` in `value` (and no user text). Route it as an
    // interaction so the engine resolves the matching `awaitChoice` waiter and
    // runs the button's `onClick` (which edits the picker card in place).
    const action = parseCardAction(activity);
    if (action) {
      const onInteraction = (replyContext: TurnContext): Promise<void> =>
        Promise.resolve(
          sink.onInteraction({
            id: action.id,
            conversationKey,
            value: action.value,
            user,
            replyTarget: {
              conversationKey,
              reference,
              context: replyContext,
            } satisfies TeamsReplyTarget,
            messageRef: {
              id: activity.replyToId ?? "",
              conversationKey,
              reference,
              context: replyContext,
            } as TeamsMessageRef,
          }),
        );

      if (this.canGoProactive()) {
        // Credentialed (real Teams): the inbound card-click turn's connector
        // client is created with an anonymous identity, so editing the card in
        // place (`updateActivity`, a PUT to the Connector) is rejected 401.
        // Run the interaction on a detached, app-id-authenticated proactive
        // context (exactly like an ordinary turn) and ack the click now.
        this.runDetached(reference, onInteraction);
      } else {
        // Anonymous local Playground: the inbound turn context is the only one
        // available (no app id for `continueConversation`) and works there.
        try {
          await onInteraction(context);
        } catch (err) {
          console.error("[bot-teams] interaction failed:", err);
        }
      }
      return;
    }

    // Ordinary chat message. Strip any `<at>bot</at>` mention (channel scope).
    let text = "";
    try {
      text = (activity.removeRecipientMention() ?? activity.text ?? "").trim();
    } catch {
      text = (activity.text ?? "").trim();
    }

    // Record the incoming message so the conversation transcript (and thus the
    // agent's history on `runAgent`) includes it.
    this.store.recordUser(conversationKey, text);

    const drive = (target: TeamsReplyTarget): Promise<void> =>
      Promise.resolve(
        sink.onTurn({
          conversationKey,
          replyTarget: target,
          userText: text,
          user,
          platform: this.platform,
        }),
      );

    if (this.canGoProactive()) {
      // Credentialed (real Teams): ack the turn now and run on a detached
      // proactive context so HITL's `awaitChoice` can suspend the run for
      // minutes without holding the HTTP turn open.
      this.runDetached(reference, (proactive) =>
        drive({ conversationKey, reference, context: proactive }),
      );
    } else {
      // Anonymous/local (M365 Playground): `continueConversation` needs an app
      // id we don't have, so run on the inbound turn context. The localhost
      // connection stays open across an `awaitChoice` suspend until the click.
      try {
        await drive({ conversationKey, reference, context });
      } catch (err) {
        console.error("[bot-teams] in-turn run failed:", err);
      }
    }
  }

  /** Whether we can send proactively (out-of-turn). Requires a Microsoft app id. */
  private canGoProactive(): boolean {
    return Boolean(this.opts.clientId ?? process.env.clientId);
  }

  /**
   * Run `fn` against a proactive `TurnContext` opened by `continueConversation`,
   * detached from any inbound HTTP turn. Fire-and-forget: the caller acks the
   * inbound turn immediately and this runs (and may suspend at `awaitChoice`)
   * in the background. Errors are logged, never surfaced to the inbound turn.
   */
  private runDetached(
    reference: Partial<ConversationReference>,
    fn: (context: TurnContext) => Promise<void>,
  ): void {
    void this.withProactive(reference, fn).catch((err) => {
      console.error("[bot-teams] detached turn failed:", err);
    });
  }

  /** Open a proactive `TurnContext` for the conversation and await `fn`. */
  private async withProactive(
    reference: Partial<ConversationReference>,
    fn: (context: TurnContext) => Promise<void>,
  ): Promise<void> {
    if (!this.cloud) return;
    const appId = this.opts.clientId ?? process.env.clientId ?? "";
    await this.cloud.continueConversation(
      appId,
      reference as Parameters<CloudAdapter["continueConversation"]>[1],
      (context) => fn(context),
    );
  }

  /**
   * Render IR to a native payload: plain text when it collapses to text,
   * otherwise an Adaptive Card. (A bare `Echo: hi` is a text bubble; structured
   * or interactive UI becomes a card.)
   */
  render(ir: BotNode[]): TeamsActivityPayload {
    return isPlainText(ir)
      ? { text: renderTeamsMarkdown(ir) }
      : { card: renderAdaptiveCard(ir) };
  }

  async post(target: ReplyTarget, ir: BotNode[]): Promise<MessageRef> {
    const t = target as TeamsReplyTarget;
    const payload = this.render(ir);
    const id =
      "text" in payload
        ? await this.sendText(t, payload.text)
        : await this.sendCard(t, payload.card);
    return { id, conversationKey: t.conversationKey, context: t.context };
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    const r = ref as TeamsMessageRef;
    if (!r.id) return;
    const payload = this.render(ir);
    // `updateActivity` re-derives addressing from the turn, so we build a fresh
    // activity carrying only the id + new content (cloning the inbound activity
    // drags fields that fail the SDK's re-validation).
    const edit = async (context: TurnContext): Promise<void> => {
      const activity =
        "text" in payload
          ? MessageFactory.text(payload.text)
          : MessageFactory.attachment(CardFactory.adaptiveCard(payload.card));
      activity.id = r.id;
      await context.updateActivity(activity);
    };
    // Prefer a live context; otherwise re-enter the conversation out-of-turn so
    // a picker card can be edited in place after its run has detached.
    if (r.context) {
      await edit(r.context);
    } else if (r.reference) {
      await this.withProactive(r.reference, edit);
    }
  }

  /**
   * Stream a text reply by message edit: post the first content, then
   * `updateActivity` the same message as the buffer grows (throttled). This is
   * Teams' baseline streaming model: no native token streaming.
   */
  async stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as TeamsReplyTarget;
    const stream = new TeamsMessageStream({
      post: (text) => this.sendText(t, text),
      update: (id, text) => this.updateText(t, id, text),
      typing: () => this.sendTyping(t),
    });
    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    const id = (await stream.finish()) ?? "";
    return { id, conversationKey: t.conversationKey, context: t.context };
  }

  async delete(ref: MessageRef): Promise<void> {
    const r = ref as TeamsMessageRef;
    if (!r.context || !r.id) return;
    await r.context.deleteActivity(r.id);
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    const t = target as TeamsReplyTarget;
    return createRunRenderer({
      interruptEventNames: this.opts.interruptEventNames,
      post: (text) => this.sendText(t, text),
      update: (id, text) => this.updateText(t, id, text),
      typing: () => this.sendTyping(t),
      recordAssistant: (text) =>
        this.store.recordAssistant(t.conversationKey, text),
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    const activity = raw as Activity;
    const action = parseCardAction(activity);
    if (!action) return undefined;
    const conversationKey = conversationKeyOf(activity);
    const reference = activity.getConversationReference?.();
    const from = activity.from;
    return {
      id: action.id,
      conversationKey,
      value: action.value,
      user: from?.id ? { id: from.id, name: from.name } : undefined,
      replyTarget: { conversationKey, reference } satisfies TeamsReplyTarget,
      messageRef: {
        id: activity.replyToId ?? "",
        conversationKey,
        reference,
      } as TeamsMessageRef,
    };
  }

  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    // Directory lookups require Microsoft Graph; not wired in milestone-1.
    return undefined;
  }

  get conversationStore(): ConversationStore {
    return this.store;
  }

  /** Return the conversation transcript the adapter has accumulated. */
  async getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    const t = target as TeamsReplyTarget;
    return this.store.getTranscript(t.conversationKey);
  }

  /** Send plain Markdown text, preferring the live turn context. */
  private async sendText(t: TeamsReplyTarget, text: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (t.context) {
      const res = await t.context.sendActivity(trimmed);
      return res?.id ?? "";
    }
    // Out-of-turn (proactive) send: re-enter the conversation by reference.
    if (this.cloud && t.reference) {
      let id = "";
      const appId = this.opts.clientId ?? process.env.clientId ?? "";
      await this.cloud.continueConversation(
        appId,
        t.reference as Parameters<CloudAdapter["continueConversation"]>[1],
        async (context) => {
          const res = await context.sendActivity(trimmed);
          id = res?.id ?? "";
        },
      );
      return id;
    }
    return "";
  }

  /** Send an Adaptive Card as a message attachment on the live turn. */
  private async sendCard(
    t: TeamsReplyTarget,
    card: AdaptiveCard,
  ): Promise<string> {
    const activity = MessageFactory.attachment(CardFactory.adaptiveCard(card));
    if (t.context) {
      const res = await t.context.sendActivity(activity);
      return res?.id ?? "";
    }
    if (this.cloud && t.reference) {
      let id = "";
      const appId = this.opts.clientId ?? process.env.clientId ?? "";
      await this.cloud.continueConversation(
        appId,
        t.reference as Parameters<CloudAdapter["continueConversation"]>[1],
        async (context) => {
          const res = await context.sendActivity(activity);
          id = res?.id ?? "";
        },
      );
      return id;
    }
    return "";
  }

  /** Edit a previously-posted text activity in place (streamed-by-edit). */
  private async updateText(
    t: TeamsReplyTarget,
    id: string,
    text: string,
  ): Promise<void> {
    if (!t.context || !id) return;
    const activity = MessageFactory.text(text);
    activity.id = id;
    await t.context.updateActivity(activity);
  }

  /** Fire a typing indicator (shown while the agent works). */
  private async sendTyping(t: TeamsReplyTarget): Promise<void> {
    if (!t.context) return;
    try {
      await t.context.sendActivity(new Activity(ActivityTypes.Typing));
    } catch {
      // Typing is best-effort; never let it sink a reply.
    }
  }
}

/** Construct a Microsoft Teams `PlatformAdapter`. */
export function teams(opts: TeamsAdapterOptions = {}): TeamsAdapter {
  return new TeamsAdapter(opts);
}
