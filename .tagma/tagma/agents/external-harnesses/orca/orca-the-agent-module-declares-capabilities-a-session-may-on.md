---
id: 01a17315-5e15-7fb3-a572-3dee224d1efb
title: "Orca: the agent module declares capabilities, a session may only narrow them (rewind → history-not-paginated / outcome-unknown), readers branch on the answer; TUI has no capability record, refusal is a `null` argv; what is unsupported was read in .external/orca @0df25b7"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca",
      "ref": ".external/orca @0df25b7"
    }
  }
---
How Orca declares and narrows rollback/fork capability: a capabilities record on every structured agent, which a live session may only narrow, and a separate mechanism for TUI, where "capabilities" are argv functions returning `null`. Read in `.external/orca` @0df25b7ac9 (2026-10-11); the code was never run. Paths are from `src/`.

## Observations

**Structured agents (chat on SDK/app-server/ACP/Pi RPC).**
- The `AgentSessionCapabilities` record (`shared/agent-session-capabilities.ts`): `rewind`, `compact`, `threadGoal`, `contextUsage`, `imagePrompts` (booleans), `steering: 'inject' | 'queue'`, `approvalEnforcement: 'provider' | 'orca'`. Docstring: declared "before any session runs", readers branch on the record rather than the agent name; "A running session may narrow a declared capability (a Codex thread with legacy history cannot rewind) but never widens one"; this is plain data, the host sends it to clients as is.
- Declared by the agent's own module: `StructuredAgentDefinition.capabilities` (`main/native-chat/agent-session-wire/structured-agent-definition.ts`); values: Codex `rewind: true, threadGoal: true, contextUsage: false, steering: 'inject'`; Claude `rewind: false, contextUsage: true, steering: 'inject'`; ACP `rewind: false, steering: 'queue', approvalEnforcement: 'orca'`; Pi `rewind: false`.
- The registry (`structured-agent-registry.ts`) refuses at build if a declared capability has no adapter method behind it: `compact` → `compact`, `threadGoal` → `changeThreadGoal`, `rewind` → `rewind` and `recoverRewind` ("a declared capability always has the adapter method behind it"); double agent registration is also an error. The router (`structured-agent-session-adapter-router.ts`) knows no agent names, only the registry.
- Narrowing: `rewindSupport(sessionId, agent)` in the router first reads the owner's declaration (`capabilityOwner` — the live adapter, or for a resting session the agent it starts under); if `rewind` is not declared — `{supported: false, reason: 'unsupported'}`; otherwise it asks the adapter, which may only narrow. The Codex adapter (`main/codex/codex-structured-session-adapter.ts`) answers `history-not-paginated` when `session.historyMode === 'legacy'`; the mode is learned when opening the thread (`codex-structured-thread-open.ts`, the answer's `historyMode` field), at preflight (`thread/read`), or when `thread/revert` answers with an error containing "thread/revert only supports paginated threads" (matched on the message string, `codex-structured-rewind.ts`), after which the value is remembered in the session. Error code -32601 yields `unsupported`.
- The host applies the third narrowing: while the rewind record is in `prepared` or `provider-succeeded`, `structured-agent-session-options-read.ts` answers `{supported: false, reason: 'outcome-unknown'}` instead of the adapter's answer.
- The answer type is `AgentSessionRewindSupport = {supported: true} | {supported: false, reason}` with a closed reason list (`shared/agent-session-rewind.ts`: `unsupported`, `history-not-paginated`, `busy`, `stale-epoch`, `invalid-target`, `history-limit`, `provider-refused`, `proof-mismatch`, `outcome-unknown`); a mutation refusal returns the same (`rewindRefusal` → `agent_session_operation_invalid` or `agent_session_operation_unknown` for `outcome-unknown`), the UI labels each (`native-chat-rewind-copy.ts`).
- Readers branch on this answer. Client: `nativeChatRewindOffered(support)` — the act is shown when `supported` or the reason is `outcome-unknown` ("An in-doubt read is still capable: the status feed's live latch, not this cached read, says when it resolves"); otherwise the row gets no act; `blockedReason` in `use-native-chat-rewind.ts` separates "reason not to offer" from "reason to disable for now". Host: the conversation command list is built from `compact` (`['clear','compact']` or `['clear']`), `threadGoal` and `contextUsage` add their blocks to the options-read answer (`structured-agent-session-options-read.ts`); the client reads `imagePrompts` from the agent record the host published (`renderer/src/runtime/use-host-structured-agent.ts`: "An unlisted agent claims nothing", the old truth kept for built-in claude/codex).
- Host level (a separate layer): runtime capability rows in `shared/protocol-version.ts` and `agent-session-resume-runtime-capabilities.ts`, e.g. `agent-session.rewind.v1` ("The RPC is registered unconditionally; per-session rewind support is a separate check"), `agent-session.rewind-recovery.v1` ("the rewind UI relies on the next send settling an in-doubt rewind, even with the agent up"), `agent-session.kimi-resume.v1`, etc. The client reads them via `renderer/src/runtime/structured-agent-session-host-capability.ts`: state `unknown | supported | unsupported`, "a failed probe is not evidence about the host", a remote host is asked again when the connection recovers. Why the resume flags exist: a new enum member on an old host yields `invalid_argument`, and no fallback over this code is provided.

**TUI surface.**
- Terminal agents have no capability record. "Can resume" = the agent is in `RESUMABLE_TUI_AGENTS` and `getAgentResumeArgv` returns non-`null` for the given identifier kind; "can fork" = `getAgentForkArgv` is non-`null` (`shared/agent-resume-argv.ts`). Refusal is a `null` value, not an error; `buildAgentResumeStartupPlan` returns `null`, the UI shows a generic "This session cannot be opened in the CLI.".
- Visibility of the history rows themselves: `aiVaultSessionCliForkWorktreeId` yields the target workspace only if the row belongs to structured chat and the agent is claude or codex (`renderer/src/components/right-sidebar/ai-vault-session-cli-fork.ts`).
- The host needs the agent before it is recorded in the RPC enum: extending `RESUMABLE_TUI_AGENTS` is a schema change to `terminal.ensureAgentSession`, which is why the `*-resume.v1` flags appeared.

## What Orca deliberately does not support (as stated in code)

- TUI fork for anyone except Claude and Codex: the "forks Claude and Codex and nothing else" test; comment — fork is needed "only [for] the two agents native chat can own a conversation for". These are comments in `agent-resume-argv.ts` and `ai-vault-session-fork-startup.ts`: fork exists so the terminal does not become a second writer into the chat conversation. That other CLIs (Gemini, Grok, Devin, Cursor, OpenCode) have no fork of their own is not asserted by Orca code; such a conclusion would be a guess.
- Substituting a plain resume for a fork: "refuses a fork for an agent that cannot fork rather than resuming it".
- Claude rewind: `rewind: false` ("marker-based rewind proof can never pass on the real binary; rewind returns via a fork"); a hanging rewind from a previous build closes as `unsupported`.
- Rewind of ACP agents: "ACP has no stable rewind or goal method".
- Rewind of a Codex thread with unpaginated (`legacy`) history and of a rollback past the `/clear` boundary (a target before the boundary or the divider itself is refused before contacting the provider: `structured-agent-session-clear-rewind.test.ts` "rejects prefix and divider targets before acquiring or calling the provider").
- Rewind of rows that open no turn: steer, queue, command, goal, another agent's message, a picture with no local file (`native-chat-rewind-eligibility.ts`).
- Rollback/fork from a live TUI pane: searching the terminal and hooks directories for the word rewind finds nothing; the only TUI "fork" is a contextual one over scrollback text in a new worktree (see the TUI fork node).
- A joint `-r<id>` is not stripped when replacing the Claude selector ("any `-r…` token is ambiguous… no arity table can keep up with the CLI").
- Resume on another host: the record is not launched until its host is confirmed, because the id names a transcript on the machine where it was captured.

## What the reading does not establish

- None of these refusals was verified on live CLIs; the "cannot" reasons come from Orca comments.
- Behavior beyond the two built-in agents (Pi RPC `--fork <file>`) was read only shallowly: in Pi RPC at chat launch, if the saved session lies in a different directory than the working one, launch goes with `--fork` (`main/pi/rpc-launch-resolution.ts`), and in the handle record that is `origin: 'forked'`; but I found no user-facing "fork Pi" item.
- How Orca's web client and mobile app read the same capabilities was not read.
