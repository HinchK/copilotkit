// Dedicated runtime for the /demos/voice cell (Claude SDK TypeScript).
//
// Goals
// -----
// 1. Advertise `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handle `POST /transcribe` by invoking an OpenAI-backed
//    `TranscriptionServiceOpenAI` (from `@copilotkit/voice`).
// 3. Return a deterministic 4xx when `OPENAI_API_KEY` is not configured.
//
// Wires the V2 `CopilotRuntime` directly because the V1 wrapper drops the
// `transcriptionService` option. V2 URL-routes on `/info`, `/agent/:id/run`,
// `/transcribe`, etc., so the route lives at `[[...slug]]/route.ts`.

// @region[voice-runtime]
// @region[transcription-service-guard]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  TranscriptionService,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type {
  CopilotRuntimeOptions,
  TranscribeFileOptions,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });
type StaticRuntimeAgents = Awaited<
  Exclude<CopilotRuntimeOptions["agents"], (...args: never[]) => unknown>
>;
type RuntimeAgent = StaticRuntimeAgents[keyof StaticRuntimeAgents];

// CopilotRuntime 1.59.4 types against @ag-ui/client@0.0.53 while the
// current local install may still expose @ag-ui/client@0.0.55 at the app root.
// AbstractAgent has private fields, so TypeScript treats those otherwise
// compatible HttpAgent instances nominally. Keep the bridge at the runtime
// boundary; package.json/lock align the clean install back to 0.0.53.
const voiceDemoAgents: Record<string, RuntimeAgent> = {
  "voice-demo": voiceDemoAgent as unknown as RuntimeAgent,
  default: voiceDemoAgent as unknown as RuntimeAgent,
};

class GuardedOpenAITranscriptionService extends TranscriptionService {
  private delegate: TranscriptionServiceOpenAI | null;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    this.delegate = apiKey
      ? new TranscriptionServiceOpenAI({ openai: new OpenAI({ apiKey }) })
      : null;
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (!this.delegate) {
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}
// @endregion[transcription-service-guard]

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    agents: voiceDemoAgents,
    transcriptionService: new GuardedOpenAITranscriptionService(),
  });

  cachedHandler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit-voice",
  });
  return cachedHandler;
}

export const POST = (req: NextRequest) => getHandler()(req);
export const GET = (req: NextRequest) => getHandler()(req);
export const PUT = (req: NextRequest) => getHandler()(req);
export const DELETE = (req: NextRequest) => getHandler()(req);
// @endregion[voice-runtime]
