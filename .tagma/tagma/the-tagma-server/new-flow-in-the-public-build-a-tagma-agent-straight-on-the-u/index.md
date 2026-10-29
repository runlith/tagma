---
id: 01a14faf-bb73-7377-8fb4-1f38c016c087
title: "New flow in the public build: a Tagma agent straight on the user's subscription — Claude, then ChatGPT — while \"Claude Code\" in the menu means only the CLI in a terminal"
ord: 132
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
## Why

A public build reaches models only through paths the vendors allow. A Claude subscription is available only through a genuine `claude` — in a terminal or through an Agent SDK runner (ACP). A ChatGPT subscription is available through Tagma's own sign-in (`openai-oauth`) or the Codex CLI sign-in this provider picks up.

Signing into work does not add up right now (code as of 2026-10-18):

- The "Claude Code" item in the "+" menu stands under the "Harness in terminal" heading but opens a Tagma-agent draft on the `claude-code` provider's model. That is the same flow as "New Tagma agent" with the Claude model, only through a second door.
- The SDK path wears Claude Code's name and pixel mark. The Agent SDK branding rules forbid it.
- A new user with only a Claude Code sign-in gets a draft on the `openai-oauth` provider's GPT-5.6 Terra with no account: `fallbackModel` iterates only wire providers, and `claude-code` is a harness.
- A Codex user starts on GPT-5.6 Terra although the ChatGPT subscription's current model is GPT-6.1 Sol.

## What the user gets

Three thread kinds, each with one door and the name of what opens:

- **Tagma agent** — chat; loop, prompt, tools, law and feed belong to Tagma. Model — any connected one: Claude on a subscription through the Agent SDK, GPT on a ChatGPT subscription, key-based models. The Claude flow on ACP is this: Claude Code gives it only the model and the sign-in.
- **CLI in terminal** — genuine Claude Code, Codex, Grok Build, Devin, Cursor and Gemini CLI in a Tagma terminal, with their own sign-in, model and settings; Tagma attaches hooks, its tools and the project law to them.
- **Vendor agent in chat** — today only Devin over ACP. Chosen by a setting and a switch on the thread itself, with no menu section of its own.

A new user immediately writes the first message on their subscription's model: Tagma itself finds the Claude Code or Codex sign-in and picks the model. With no sign-ins, the draft offers sign-in.

## Decisions shared by both parts

1. **Subscription order: Claude through Claude Code, then ChatGPT, then other subscriptions; keys after subscriptions.** A key appears only where the user pasted it, so on first launch the queue holds subscriptions. One order across the product: it picks the default model, and model-picker groups and Providers sections stand in it. Anthropic ahead of OpenAI because for a developer tool the Claude subscription matters more.
2. **"Claude Code" is only the genuine CLI in a terminal.** The Agent SDK branding guidelines (code.claude.com/docs/en/agent-sdk/overview, read 2026-10-18) forbid calling an SDK integration "Claude Code" or "Claude Code Agent" and repeating Claude Code visuals. Allowed: "Claude Agent" (recommended for dropdowns), "Claude" inside agent menus, "… Powered by Claude". So Tagma shows no "Sign in with Claude": Claude Code itself signs in (`claude auth login`).
3. **`harness:claude` is always born in a terminal.** Claude on ACP is born by picking the `claude-code` provider's model through `HarnessRegistry.seating`, and an existing thread moves between terminal and Tagma agent via `set_thread_transport`. The `threads.harnessTransport` setting stays for vendors whose ACP drives the vendor's own agent (Devin).

Menu, model-picker and sign-in-card sketch — the "New agent menu" artifact page (http://localhost:5634/a/37dd8602500c); where the sketch diverges from the spec, the spec rules.

## Operator check

On a clean build with no sign-ins — four scenarios: Codex only, Claude Code only, both, nothing; sign-in from the card; menu and model picker. This is the operator's check, not a task completion condition.
