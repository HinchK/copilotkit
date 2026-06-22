/**
 * Microsoft Teams demo bot for `@copilotkit/bot-teams`.
 *
 * Every message runs a real CopilotKit `BuiltInAgent`. Replies stream by
 * message-edit, and the agent renders **Adaptive Cards automatically** by
 * calling the `show_card` tool whenever structured data (a summary, status,
 * table, list of facts) is clearer as a card than as prose. Consequential
 * actions go through a human-in-the-loop approval gate (`confirm_write`).
 *
 * Requires `OPENAI_API_KEY`. No Microsoft credentials are needed to test in the
 * M365 Agents Playground:
 *
 *   pnpm start        # bot on http://localhost:3978/api/messages
 *   pnpm playground   # M365 Agents Playground UI (http://localhost:56150)
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createBot, defineBotTool } from "@copilotkit/bot";
import { teams, SanitizingHttpAgent } from "@copilotkit/bot-teams";
import { BuiltInAgent, CopilotSseRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { z } from "zod";
import { hitlTools } from "./human-in-the-loop/index.js";
import {
  Message,
  Header,
  Section,
  Fields,
  Field,
  Table,
  Row,
  Cell,
} from "@copilotkit/bot-ui";

// This demo drives a real agent, so an LLM key is required. Fail fast with a
// clear message rather than booting a bot that errors on the first message.
if (!process.env.OPENAI_API_KEY) {
  console.error(
    "Missing OPENAI_API_KEY.\n" +
      "This demo runs a CopilotKit BuiltInAgent, which needs an LLM API key.\n" +
      "  export OPENAI_API_KEY=sk-...   (or add it to examples/teams/.env)\n" +
      "Optional: OPENAI_MODEL (defaults to openai/gpt-4o-mini).",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3978);

const SYSTEM_PROMPT =
  "You are a helpful Microsoft Teams assistant powered by CopilotKit. Keep " +
  "replies concise. When the user asks for a summary, status, list, " +
  "comparison, or any structured/tabular data, call the show_card tool to " +
  "render it as a rich Adaptive Card instead of writing it out as plain text.\n\n" +
  "When the user asks to send, post, or announce something to the team, FIRST " +
  "draft the announcement, then call confirm_write with a one-line action " +
  "summary and the drafted text to get the user's approval. Only call " +
  "send_announcement after confirm_write returns approval; if it is declined, " +
  "acknowledge and do not send.";

// The agent is a CopilotKit `BuiltInAgent` served over a local
// `CopilotSseRuntime`, and the bot connects to it with a `SanitizingHttpAgent`
// (the re-runnable `HttpAgent` this package exports, as bot-slack does). A
// `BuiltInAgent` can't be handed to `createBot` directly: the bot's run loop
// re-invokes the agent once per tool round (call → result → respond), and a
// single `BuiltInAgent` instance rejects a second concurrent run. An
// `HttpAgent` is re-runnable, so it drives the multi-step + HITL loops cleanly.
const agentId = "assistant";
const runtimePort = Number(process.env.RUNTIME_PORT ?? 8200);
const runtimeAgentUrl = `http://localhost:${runtimePort}/api/copilotkit/agent/${agentId}/run`;

const runtime = new CopilotSseRuntime({
  agents: {
    [agentId]: new BuiltInAgent({
      model: process.env.OPENAI_MODEL ?? "openai/gpt-4o-mini",
      prompt: SYSTEM_PROMPT,
    }),
  },
});
createServer(
  createCopilotNodeListener({ runtime, basePath: "/api/copilotkit" }),
).listen(runtimePort, () => {
  console.log(`Runtime (BuiltInAgent) listening on :${runtimePort}`);
});

/**
 * The card the **agent** renders on demand. The LLM calls this tool with
 * structured args; the handler turns them into an Adaptive Card via CopilotKit's
 * platform-agnostic JSX, then returns a short ack so the model doesn't restate
 * the card in prose.
 */
const showCard = defineBotTool({
  name: "show_card",
  description:
    "Render a rich Adaptive Card in Teams. Call this whenever a summary, " +
    "status report, comparison, set of facts, or tabular data would be clearer " +
    "as a card than as plain prose. Prefer a card for anything structured.",
  parameters: z.object({
    title: z.string().describe("Card header text"),
    body: z.string().describe("A short intro paragraph (markdown allowed)"),
    facts: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
      .describe("Key/value facts rendered as a list"),
    table: z
      .object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      })
      .optional()
      .describe("Optional simple table; each row is an array of cell strings"),
  }),
  async handler({ title, body, facts, table }, { thread }) {
    await thread.post(
      <Message accent="#5B5FC7">
        <Header>{title}</Header>
        <Section>{body}</Section>
        {facts && facts.length > 0 ? (
          <Fields>
            {facts.map((f, i) => (
              <Field key={i}>{`${f.label}: ${f.value}`}</Field>
            ))}
          </Fields>
        ) : null}
        {table ? (
          <Table columns={table.columns.map((header) => ({ header }))}>
            {table.rows.map((row, i) => (
              <Row key={i}>
                {row.map((cell, j) => (
                  <Cell key={j}>{cell}</Cell>
                ))}
              </Row>
            ))}
          </Table>
        ) : null}
      </Message>,
    );
    return "Displayed the card to the user. Give a one-line confirmation; do not restate the card's contents.";
  },
});

const bot = createBot({
  adapters: [teams({ port })],
  agent: (threadId: string) => {
    const agent = new SanitizingHttpAgent({ url: runtimeAgentUrl });
    agent.threadId = threadId;
    return agent;
  },
  tools: [showCard, ...hitlTools],
});

// Run the agent on every message. It streams text by edit and renders Adaptive
// Cards on its own via the show_card tool.
bot.onMessage(async ({ thread }) => {
  await thread.runAgent();
});

await bot.start();

console.log(
  `Teams demo bot listening at http://localhost:${port}/api/messages`,
);
console.log(
  'Run `pnpm playground`, then ask for a "summary" or "status" to see an ' +
    'auto-rendered card, or "announce X to the team" to see the HITL approval.',
);
