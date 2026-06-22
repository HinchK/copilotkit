# Teams example: demo bot

A runnable demo of [`@copilotkit/bot-teams`](../../packages/bot-teams): a
Microsoft Teams bot backed by a CopilotKit `BuiltInAgent` that shows
**streamed-by-edit replies**, **agent-rendered Adaptive Cards**, and a
**human-in-the-loop approval gate**, testable locally in the **Microsoft 365
Agents Playground** with **no Microsoft credentials**. It needs an
`OPENAI_API_KEY`.

## Run it

From this directory (after `pnpm install` at the repo root):

```sh
export OPENAI_API_KEY=sk-...   # or add it to .env (see .env.example)
pnpm start                     # starts the bot on http://localhost:3978/api/messages
```

In a second terminal:

```sh
pnpm playground   # opens the M365 Agents Playground at http://localhost:56150
```

Then, in the Playground:

- Ask anything → the agent replies, **streaming in by message edit** (a typing
  indicator first, then text that fills in as it's edited, following Teams'
  baseline post-then-`updateActivity` streaming model).
- Ask for a **summary**, **status**, or any structured data → the agent calls
  the `show_card` tool and posts an **Adaptive Card** (header, facts, table).
- Ask it to **"announce X to the team"** → it drafts the message, posts an
  **Approve/Reject card**, and only sends after you approve (the card updates in
  place to ✅/🚫).

That exercises the CopilotKit bot engine and the Teams adapter end-to-end:
streaming, agent-rendered Adaptive Cards, and human-in-the-loop.

## What's in here

- `app/index.tsx`: the whole bot, covering an in-process `BuiltInAgent` runtime,
  the `createBot({ adapters: [teams()] })` wiring, an `onMessage` handler that
  runs the agent, and the agent-facing `show_card` tool.
- `app/human-in-the-loop/`: the `confirm_write` approval gate and the Adaptive
  Card it posts. This is user-land code, not SDK code.

## Use a remote agent

By default the example serves an in-process `BuiltInAgent`. To point the bot at
a remote AG-UI endpoint (a deployed CopilotKit runtime, LangGraph, and so on)
instead, swap the `agent` factory to read a URL from the environment:

```ts
agent: (threadId) => {
  const a = new SanitizingHttpAgent({ url: process.env.AGENT_URL! });
  a.threadId = threadId;
  return a;
},
```

## Connect to Microsoft Teams

The Playground needs no credentials; real Teams does. The high-level path:

1. **Register the bot with Microsoft.** Create an [Entra app
   registration](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
   and note its Application (client) ID, Directory (tenant) ID, and a client
   secret. Create an [Azure Bot
   resource](https://learn.microsoft.com/azure/bot-service/bot-service-quickstart-registration)
   that uses that app, enable the **Microsoft Teams** channel, and set its
   **messaging endpoint** to `https://<your-host>/api/messages`.
2. **Give the bot the credentials.** Set `clientId` / `clientSecret` /
   `tenantId` (the names the M365 Agents SDK reads) in the bot's environment.
   With them set, the bot acks each turn and runs the agent on a detached
   context, so HITL approvals can resume minutes later.
3. **Build and upload the app package** (below), then in Teams: **Apps → Manage
   your apps → Upload a custom app**.

The full step-by-step walkthrough is in the [Microsoft Teams
guide](../../showcase/shell-docs/src/content/docs/frontends/teams.mdx).

## Build the Teams app package

The app package is the manifest + icons you sideload into Teams. Build it with:

```sh
pnpm package   # -> appPackage/appPackage.zip
```

The script (`appPackage/package.mjs`, dependency-free) reads your bot id from
`MICROSOFT_APP_ID` / `CLIENT_ID` / `clientId` (env or `.env`) and injects it into
the manifest, validates the manifest, and auto-generates placeholder icons if
they're missing, so the committed `manifest.json` stays a placeholder and you
never hardcode your id. See [`appPackage/README.md`](./appPackage/README.md) for
details.

## Deploy

The bot is a plain HTTP service: it serves `POST /api/messages` (plus a
`/healthz` liveness probe) and binds `PORT`, so it runs anywhere: any container
platform, a VM, or a Node process manager. A `Dockerfile` is included; because
the example imports `workspace:*` packages, **the Docker build context must be
the repo root**, not `examples/teams`.

Set the environment for wherever you deploy:

- `OPENAI_API_KEY` _(required)_: the bot runs a `BuiltInAgent` and exits at
  startup without it.
- `OPENAI_MODEL` _(optional)_: defaults to `openai/gpt-4o-mini`.
- `clientId` / `clientSecret` / `tenantId`: needed to reach real Teams (see
  above). The in-process `BuiltInAgent` runtime stays on `RUNTIME_PORT`
  (localhost-only, default 8200).

Note: the conversation store and pending HITL approvals are **in-memory**, so
they do not survive a restart. Swap in a durable store before relying on
long-lived approvals in production.
