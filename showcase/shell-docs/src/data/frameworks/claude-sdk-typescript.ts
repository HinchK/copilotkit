import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "claude-sdk-typescript",
  frameworkName: "Claude Agent SDK (TypeScript)",
  iconKey: "anthropic",
  header: "Bring your Claude agents to your users",
  subheader:
    "Give Claude Agent SDK agents rich user-facing chat, tools, generative UI, shared state, and human-in-the-loop controls with CopilotKit and AG-UI.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  guideLink: "/claude-sdk-typescript/quickstart",
  initCommand: "npx copilotkit@latest init --framework claude-sdk-typescript",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/agentic_chat",
  supportedFeatures: [
    {
      title: "Generative UI",
      description:
        "Render Claude tool calls, state, and A2UI outputs with custom UI components in real time.",
      documentationLink: "/claude-sdk-typescript/generative-ui/tool-rendering",
      demoLink:
        "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/tool_rendering",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
    },
    {
      title: "Human in the Loop",
      description:
        "Let users approve, reject, or provide extra input when a Claude agent reaches a checkpoint.",
      documentationLink: "/claude-sdk-typescript/human-in-the-loop",
      demoLink:
        "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/hitl_in_chat",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
    },
    {
      title: "Shared State",
      description:
        "Keep Claude and your React app synchronized through AG-UI state snapshots and frontend-owned context.",
      documentationLink: "/claude-sdk-typescript/shared-state",
      demoLink:
        "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/shared_state_read_write",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
    },
  ],
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  liveDemos: [
    {
      type: "saas",
      title: "SaaS Copilot",
      description:
        "A traditional SaaS application enhanced with AI agents. These copilots integrate into existing workflows where users need guided, step-by-step AI assistance.",
      iframeUrl:
        "https://examples-coagents-ai-travel-app.vercel.app?copilotOpen=true",
    },
    {
      type: "canvas",
      title: "Canvas Copilot",
      description:
        "An infinite canvas interface where users collaborate with AI agents in a spatial, visual environment for research, planning, and content creation.",
      iframeUrl: "https://examples-coagents-research-canvas-ui.vercel.app/",
    },
  ],
};

export default data;
