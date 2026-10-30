---
id: 01a108ea-e217-7ba4-b3f5-b5266c4c410f
title: "Claude SDK P1: works under Bun; own systemPrompt appends to the Claude Code identity, prompt snapshot on resume and its disable flag"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Agent SDK probe under Bun: API request frames, SDK messages, JSONL transcripts",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289, Bun 1.4.2, claude-haiku-4-5; 2026-10-04; scripts and frames in ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/ (lib.mjs, p1-main.mjs, p1-resume.mjs, p1-snap.mjs, p1-snap2.mjs, wire-*.jsonl)"
    }
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Probe P1, 2026-10-04. **Measured** — API request frames and SDK messages from the probe; **conclusions** marked. Scripts, frames (`wire-*.jsonl`, account email and id replaced with `<redacted-*>`) and transcripts — `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/` (`lib.mjs`, `p1-*.mjs`).

## Method and boundaries

The probe script is `bun` 1.4.2, `query()` from `@anthropic-ai/claude-agent-sdk` 0.3.284 (that npm has 0.3.289 — per the earlier reading [[07a7739c]], not verified), `pathToClaudeCodeExecutable` = installed `claude` 2.1.289, model `claude-haiku-4-5`, cwd — a temp project. Each API request body was captured by a `Bun.serve` proxy inside the probe process (`ANTHROPIC_BASE_URL` pointed at it; the auth header is not written to the log). Caveat: a non-first-party base URL could change Claude Code behaviour; headers and betas on the frames look like a regular launch (`cc_entrypoint=sdk-ts`), but no comparison launch without the proxy was made.

## 1. SDK works under Bun

All exercised operations — streaming `AsyncIterable<SDKUserMessage>` input, `tools`, stdio MCP, `resume`, `forkSession`, `resumeSessionAt`, `interrupt()`, `extraArgs`, `/compact` — passed under Bun 1.4.2 with no Bun-specific failures. One hang (two minutes of `api_retry`, `error:"unknown"`) came from the probe proxy process dying; a rerun in the same script with the in-process proxy passed. Unverified: launch via `tagma harness-run` from the Tagma install, another OS, the SDK with its own binary. For the profile: a Bun runner is possible; the pinned pair is an SDK and `claude` of one verified version.

## 2. Own `systemPrompt` (string): what goes on the wire

`systemPrompt: '<string>'` without preset. The API request's `system` blocks:

1. `x-anthropic-billing-header: cc_version=2.1.289.<3 hex>; cc_entrypoint=sdk-ts;` (no `cache_control`);
2. `You are a Claude agent, built on Anthropic's Claude Agent SDK.` — the Claude Code identity, always added (in a TUI-started session, at snapshot — `You are Claude Code, Anthropic's official CLI for Claude.`);
3. own string — whole, no Claude Code text. The `claude_code` preset (~32 KB in a TUI session) is not included.

Blocks 2 and 3 carry `cache_control: ephemeral, ttl 1h`. Besides `system`, Claude Code puts four `<system-reminder>` blocks in the first user message: Environment (cwd, git, platform, shell, OS), "You are powered by the model named Haiku 4.5… knowledge cutoff", `userEmail` (**the account email**, marked as auto-added context) and date. They lie in `messages`, not in `system`; on `resume` they are substituted anew before the new message. No way to switch them off was sought (in `sdk.mjs` there is an `excludeDynamicSections` option, not tried).

Other wire content Tagma does not set: `thinking` on (`budget_tokens` 31999, `display: updates`) for Haiku, `max_tokens` 32000, `context_management: clear_thinking_20251015 keep all`, `metadata.user_id` with device_id, account_uuid and session_id.

**Side request.** On the first prompt of a new session Claude Code sends a separate request of the same model (system 3059 chars "You are naming a coding session…", no tools, ~1k input tokens) — it enters `modelUsage` and `total_cost_usd`. With the `title: '<name>'` option there is no such request (verified: one POST instead of two). Not sent on `resume`.

Profile conclusion: "indistinguishable from native" is reachable for tools and prompt, but three Claude Code additions remain: the identity block, the billing block and reminders (env, model, account email, date).

## 3. `resume` with a different `systemPrompt`: the old one applies

Claude Code records a `prompt_snapshot` `attachment` record in the session JSONL (a `systemPrompt` array; after the first call — a second one with `tools` and `cliPrefix`).

- `resume` of the same session with a new string (`BETA`) — the wire got the old prompt (`ALPHA`); the model answered `ALPHA`. No new `prompt_snapshot` record added.
- The SDK `systemPromptSnapshot: false` option (present in `sdk.d.ts` 0.3.284) had no effect: neither on `resume` (`GAMMA` → `ALPHA`), nor when set from the first launch (`DELTA` → `resume` with `EPSILON` → `DELTA`).
- The CLI flag via `extraArgs: {'system-prompt-snapshot': 'off'}` works: first launch `ZETA`, `resume` with `ETA` — the wire got `ETA`. Why the SDK option does not work but the flag does is undetermined (versions: CLI 2.1.289, SDK 0.3.284).
- The snapshot does not freeze tools: `resume` with an MCP server yielding different tools put `mcp__tagma__whoami_v2` on the wire, while the prompt stayed the old one.

Profile conclusion: updating instructions mid-session without recap is possible — the runner hands `systemPrompt` and `extraArgs: {'system-prompt-snapshot': 'off'}` on every launch. This is an internal CLI flag (`--system-prompt-snapshot <on|off>` in the binary, marked in the SDK description as snapshot recording), so it must be pinned to the CLI version and verified by probe on upgrade; the fallback for decision 2 is a new vendor session with recap.
