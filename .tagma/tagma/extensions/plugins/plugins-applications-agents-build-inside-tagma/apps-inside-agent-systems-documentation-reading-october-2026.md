---
id: 01a11db3-63a5-7977-ae50-3e0cb27c8519
title: "Apps inside agent systems: documentation reading (October 2026)"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Official docs, blogs, and changelogs of Anthropic, OpenAI, Google, Microsoft/GitHub, Kiro, Cursor, Zed, JetBrains, Warp, Goose, Retool, Atlassian, Notion, Airtable, Coda, Baidu, ByteDance, xAI, Moonshot, MiniMax; read 2026-10-08",
      "ref": "https://kiro.dev/docs/crew/apps/"
    }
  }
---
Read on 2026-10-08. Ten research agents (Muse) read the official docs, blogs, and changelogs. One question: can an application be created inside an agent system that (1) is made with no outside deploy, (2) lives in the agents' flow, (3) has its own storage, logic, and background work, (4) lets the system's agents in as participants with narrow tools. Single-site generators (Lovable, Bolt, and the like) are out of scope.

## Products with a similar property set

- **Kiro Crew Apps** (docs of 2026-09-25, https://kiro.dev/docs/crew/apps/). An app is a package declaring:
  - agents, skills, and MCP servers;
  - cron and background jobs, backend processes behind a reverse proxy `/apps/{name}/api/*`, storage;
  - UI: dashboard pages, side-panel tabs, session controls by the input field.

  An app can start and stop agent sessions under a grant that is off by default. There is an App Store with a registry and a dev mode with hot-reload. Only api-scopes are actually checked; storage, cron, and network limits are declared but not enforced (“full enforcement on the roadmap”). The gateway runs locally. UI sits beside the chat, not in the ribbon.
- **Retool** (Agents, Apps, Workflows). An app is generated from a prompt, has Postgres (5 GB in the cloud) and workflows scheduled from 1 minute. Agent teams with RBAC act inside the app. An enterprise product.
- **Atlassian Rovo.** `rovo:agent`, actions on Forge functions, Automation by events and schedule, an agent Marketplace. UI limited to Forge frames.

## UI in the agent's flow: standards

- **MCP Apps** (stable 2026-01-26, SEP-1865). A tool declares a `ui://` resource, the host draws it in a sandbox iframe. The `ui/*` bridge over postMessage lets the UI call `tools/call` and `ui/message` and update the model context. No storage, background, or agents inside: state lives on the MCP server. Supported by Claude, ChatGPT (full compatibility from 2026-02-22), M365 Copilot, VS Code, and Goose.
- **AG-UI + CopilotKit** — an agent↔UI event protocol: shared two-way state, human-in-the-loop, subagents of one runtime.
- **A2UI** (Google, v1.0 candidate) — declarative UI from a pre-approved component catalog, code never crosses the trust boundary.
- **Tambo** — components that outlive turns, with state stored alongside the thread.
- **WebMCP together with MCP-UI** — an embedded app registers its tools back to the model.

## Per company: what each gives and what each lacks

- **Anthropic**
  - Artifacts: the app is written in chat, can call Claude, has storage. Storage limits: 20 MB, text only, works after publishing. No background, no agents inside.
  - Claude Code: plugins (skills, hooks, subagents, MCP), subagents with narrow tools. No user runtime.
- **OpenAI**
  - ChatGPT Apps: UI in chat, but its own MCP server and database are required.
  - Plugins (skills, MCP, UI, hooks) — a shared ChatGPT and Codex catalog.
  - Closing: GPTs — 2026-12-11, Agent Builder — 2026-11-30, Atlas — 2026-08-09.
- **Google**
  - Canvas: an HTML app beside the chat with shared data. No server logic or agents.
  - Closing: Opal — 2026-11-17, Firebase Studio — 2027-03-22.
  - Antigravity: sidecars (cron, persistent data-dir, entry into the conversation), plugins with a marketplace. No apps as entities.
  - Gemini Enterprise Agent Designer: scheduling, subagents, memory — for enterprise assistants.
- **Microsoft and GitHub**
  - Copilot Studio: Dataverse, triggers, workflows, A2A delegation. Only chat and cards in the thread.
  - MCP Apps in Copilot and VS Code: UI without state.
  - GitHub Spark (the whole app) closed 2026-08.
- **IDE.** Cursor, Windsurf and Devin, Zed, JetBrains (Junie, Air — alpha), Warp: agents write code but give no home to apps.
- **Open source**
  - Goose: MCP Apps in chat, a cron scheduler, Recipes in YAML. The app's storage is on an outside MCP server.
  - Charming runs on Goose — a closed “in-conversation app store”.
  - Roo Code closed 2026-05-15, Continue bought by Cursor in 2026-06.
- **Agent platforms**
  - Gumloop and Relevance AI: the app as an agent's artifact with data and triggers, living beside agents.
  - Letta: MemFS — memory as a git repository, plus Schedules.
  - LangGraph: checkpoints, cross-thread Store, cron.
  - Dust: several @-agents in one conversation.
- **Workspaces**
  - Airtable Omni and Coda Packs: the app assembled by conversation from native blocks, with automations and agents.
  - Notion Custom Agents: scheduling and triggers, External Agents API in alpha.
- **Asia and the new ones**
  - Baidu Miaoda and Qianfan: the agent builds and publishes the app.
  - Coze: a bot builder, folding into Doubao per Bloomberg.
  - Grok Build (GA 2026-08-19): preview in chat, publishing to `grok.me`, fork (remix), model calls without keys. No state or background.
  - Kimi Agent Swarm: up to 300 subagents.
  - ChatAndBuild and Wato (YC X26) are close in idea, but the data is only from their own pitches.

## What to adopt

- The UI format is MCP Apps. Then apps written for Claude and ChatGPT run in Tagma.
- The app's contributions and the “act in sessions” grant, off by default — as in Kiro Crew.
- The sidecar model: cron, a persistent data-dir, entry into the conversation — as in Antigravity.
- Distribution: preview, link, remix — as in Grok Build and Canvas.
- The plugin as one package of skills, MCP, subagents, and hooks — as in Claude Code, Antigravity, and OpenAI.

## Reading limits

- The IDE report was assembled via webfetch of official docs; the agent's web search did not work.
- Storage and quota limits are undisclosed for most products.
- Startup data is from their own pitches.
- No product was run by hand; everything was read from docs.
