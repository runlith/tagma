---
id: 01a17315-5e55-7250-bd2d-c0c77fb55261
title: "Orca: cases around resume, fork, and rewind it already closed — id and hooks, second writer, command line and shells, Codex account, Codex rollback; one file per case — read in .external/orca @0df25b7"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca",
      "ref": ".external/orca @0df25b7"
    }
  }
---
A catalog of resume, fork, and rewind cases Orca already met and closed: each with the file where it is handled or verified. Read in `.external/orca` @0df25b7ac9 (2026-10-11) from code, "Why:" comments, and test names; the code was never run. Paths are from `src/` unless stated otherwise. `#NNNN` numbers are issue/PR links from Orca comments; they were never read themselves.

## Where the session id comes from and what it means

- **A Claude transcript filename ≠ the hook's `session_id`** (newer Claude Code): the path the hook passed (`transcript_path`) is kept in `providerSession.transcriptPath`, because an id-based file search no longer finds it. `shared/agent-session-resume.ts` (comment at `AgentProviderSessionMetadata`), test `agent-session-resume.test.ts` "captures the hook transcript_path for native-chat agents (claude/codex)".
- **Different identifier kinds**: `session_id` and `conversation_id` (Cursor, Antigravity) are not interchangeable; argv is built only for the matching key. `shared/agent-resume-argv.ts`; tests "rejects devin resume when provider session key is not session_id", jcode likewise.
- **A Codex child-agent hook arrives at the parent pane with the child's id** → with an `agent_id` present no `providerSession` is taken. `shared/agent-hook-listener.ts` (comment at the `providerSession` computation).
- **An id change inside the pane with no closing hook** (Claude: `/clear`, restart, resume): the new `session_id` is the only evidence; it drops the previous bindings (cron, one-shot subagent) but not a live teammate or background shell; a child-agent event with a foreign id or an event with no id drops nothing; a `SessionStart` with `source: 'compact'` does not count as a new session. `shared/agent-hook-listener-session-replacement.test.ts`.
- **Unsafe id**: length ≤ 512, no control characters, never starts with `-` (or it would become a flag); transcript paths are cleaned the same way. `normalizeSessionId`, `hasUnsafeProviderSessionIdChars` in `shared/agent-session-resume.ts`.
- **Some CLIs have no stable transcript path**: ZCode — a temp file deleted when the hook exits, so only the id works; DSH — always an empty `transcript_path`; Kiro — no path; Pi/OMP — needs `session_file`, an ephemeral session without a file is never captured (test "does not capture ephemeral Pi sessions without a session file"). Same file.
- **Record keys bind by identity, not by text**: Codex renumbers `item-N` on every resume — a journal row key is thread + turn + ordinal inside the turn; `thread/fork` copies turns with their source turn ids, so the thread id stays in the key; Claude `--fork-session` copies record uuids, so the key is session id + uuid. `shared/agent-session-journal-item-key.ts`, `main/native-chat/agent-session-journal/journal-legacy-identity.ts`, `journal-item-identity.test.ts`.
- **A fork is not a resume**: the provider handle chain refuses `agent_session_provider_handle_forked` when a resume lands on a different root; `forked` is accepted only with a new root and `forkedFromKey`; on chain overflow (`chain_overflow`) old links are not dropped — the journal gains a new epoch instead, or the fork's provenance would be lost. `shared/agent-session-provider-handle.ts`, `agent-session-provider-handle.test.ts`.
- **The continuation marker stores the handle root, not the full key**: a Claude key contains a leaf uuid that shifts on close, and key comparison would refuse every Claude session. `shared/agent-session-resume-marker.ts`. Same file: Claude has no turn id in the window between submit and SDK echo, so the work may be a "submission" rather than a "turn".

## Never run a resume twice, and never run it in the wrong place

- **Second writer**: a resume of a chat-owned id is refused (`agent_session_conflict` / `agent_session_ownership_unknown`), while a fork and a command naming a different id are allowed; "target-less" forms (`--continue`, `-c`, bare `--resume`, `--last`) are inadmissible while any conversation belongs to chat. `main/ai-vault/structured-session-ownership.ts` and `.test.ts`.
- **One id — one owner in the workspace** (gate `agent-session.provider-ownership` in `config/reliability-gates.jsonc`, ~line 9762): launch, restore, sleep, dedup, and remount must never reproduce an id already owned by a live, queued, or PTY-bound pane; with no projection state the renderer takes exactly the existing PTY; E2E on local macOS with Codex, other platforms/providers (SSH, WSL, Linux, Windows) marked as never run. `renderer/src/lib/resume-sleeping-agent-session.ts` (comment on the live PTY: "Forking the transcript is not recoverable; declining to auto-resume").
- **Host unknown** (`unverifiable`) → launch nothing, delete no record: a resume before the host answers would fork a second agent onto a transcript the host is still writing (STA-3500). A record from another host is skipped, not deleted: the id is a valid locator on its own machine. Same file; `renderer/src/lib/sleeping-record-execution-host-scope.ts`.
- **Record provenance**: a "worktree-sleep" record is executed by worktree activation, while "quit/live" only by the pane's own cold restore — otherwise a second tab duplicates the warm one (#5232); `restoreOnTabOpenOnly` stops a mobile wake from reviving all tabs at once (#11598). `shared/agent-session-resume.ts`.
- **Structured chat must never land in terminal "sleeping" records**: field `terminalResumeEligible: false`; test "does not capture a structured native owner for terminal resume on restart". `renderer/src/store/slices/agent-status-provider-session.test.ts`.
- **A late heartbeat never revives a finished record**, and an explicit quit-capture stays a handle until replaced by another session. `agent-status-provider-session-actions.ts`.
- **Launch token**: a missing or mismatched `launchToken` is stale evidence, even when the manual launch used the same id; launchConfig is bound to identity (agent, tab, leaf, handle, token, providerSession). Cold restore sets `ORCA_AGENT_LAUNCH_TOKEN`. `cold-restore-resume-startup.ts`.
- **An interrupted turn** is also resumable: `claude --resume` opens the transcript at the prompt. `resume-sleeping-agent-session.ts` (comment at `isInvalidWorktreeActivationRecord`).

## Launch command line

- **A selector in the user command** (`claude --continue`, a saved old `--resume X`) is stripped and replaced with one authoritative one; with no way to parse safely (wrappers, PowerShell `--%` and subexpressions, cmd `^` and single quotes, line continuation, unclosed substitution, a surrounding operator) — the command stays as is, the selector is appended. #12982; `shared/agent-resume-launch-command.ts` and dozens of tests in `agent-resume-launch-command.test.ts`.
- **Only exact forms** are stripped; `claude` is recognized only in command position (index 0, after `--`, after PowerShell `&`, or after `NAME=value` assignments), so an argument like `/path/claude` (an ssh key, a project directory) is never mistaken for the executable. Same file.
- **Stripping an appended resume back**: space boundary (`resume-foo` ≠ `resume`), refusal when the locator sits outside the tail, `unrecognized` instead of launching "with an uncancelled resume". `shared/agent-resume-argv-drop.ts` and test (incl. "refuses when the locator also appears outside the trailing resume argv").
- **Flag forms**: Copilot — only `--resume=<id>` (the single documented form, same in local and remote commands); Kiro — `--resume-id`; OpenCode 2 — the standalone/shared mode belongs to the launch command, including user override; Kimi/Muse — only in the recorded directory; DSH — by workspace path. `shared/agent-resume-argv.ts`, `tui-agent-startup-copilot-resume.test.ts`, `tui-agent-startup-kiro-resume.test.ts`, `opencode2-resume-launch-mode.test.ts`.
- **Shell**: the `CODEX_HOME` env-prefix goes on the agent, not on the whole `cd … && agent` chain (`cd` is a builtin); `env -u` must not strip the just-set `CODEX_HOME`; under `set -u` the cleanup operator for POSIX shells probes the unbound `$fish_pid` and crashes, so it must not stand before the agent, and variable stripping runs as `env -u` on the agent itself; cmd: "an interactive cmd splits the doubled quotes required by a nested `cmd /s /c` wrapper"; `cd` before the agent, so a failed `cd` never launches the agent in the wrong place. `shared/ai-vault-resume-command.ts`.
- **cwd**: Codex without `tui.resume_cwd=current` asks for the folder and offers the recorded one, even a deleted one (#17745); a deleted SSH folder is stripped only after an ENOENT confirmation, and a lost host is no proof; Kimi/Muse are exempt. `shared/tui-agent-resume-startup.ts`, `renderer/src/lib/ai-vault-session-resume-preparation.ts`.
- **Old host**: a new enum member yields `invalid_argument`, which a fallback launch never retries, so the client checks the capability first; a fork-preparation refusal on an old paired host becomes "Update Orca on the host…". `shared/agent-session-resume-runtime-capabilities.ts`, `ai-vault-session-cli-fork.ts`, `ai-vault-session-launch-actions.test.ts`.

## Accounts and the Codex home

- **Resume under an account whose rollout is missing or whose home is untrusted**: the argv is stripped from `command`, from `ORCA_SEQUENCED_STARTUP_COMMAND` (the wrapper `eval`s it), in the local, daemon, and runtime controllers; the pane reports a clean start (`agentResumeUnavailable`), but not on reattach; an unstrippable resume is refused when the metadata declared a Codex layout and launched as is when the metadata is of a foreign layout (a pane renamed to codex with `~/.claude` metadata). `main/ipc/pty-spawn-env-codex-resume-provenance.test.ts`.
- **Real home with no prefix**: when resume launches without `CODEX_HOME`, the pane removes `CODEX_HOME` and `ORCA_CODEX_HOME` from the inherited env. `realHomeCodexResumeEnvDeletion` in `shared/ai-vault-resume-command.ts`.
- **A fork carries no providerSession** → the home hook-readiness that spawn does for resume is done by preparation for fork; a best-effort failure (the fork launches without hooks). `main/codex/codex-ai-vault-session-resume.ts` and `.test.ts` ("still answers a fork when readying its home fails").

## Rollback (Codex)

- **Rollback only for an idle thread with no active turns and no pending submit**; the check repeats after reading history (a race between preflight and revert). `main/codex/codex-structured-rewind.ts`, tests "rechecks provider idleness after preflight hydration", "refuses activity arriving during the preflight await", "refuses activity arriving during recovery hydration".
- **History over the limit** → `history-limit` before mutation; **no target** → `invalid-target` before mutation; **legacy thread** → `history-not-paginated` with no revert call; the "only supports paginated threads" error also moves the session to legacy; provider text is never shown. Tests "refuses history exceeding hydration capacity before mutating the provider", "refuses a missing target before mutation", "maps native legacy refusal without exposing provider text or falling back".
- **A read failure after revert is an unknown outcome — revert is never retried**, only the read repeats; chat blocks submits and duplicate rewinds while the outcome is unknown. "treats hydration failure after revert as unknown and never retries revert", `structured-agent-session-rewind.test.ts` "keeps a failed hydration epoch intact and blocks sends and duplicate rewind while it stays unknown".
- **Revert acknowledged but not kept by the provider** → the record closes as a refusal, chat attaches and sends ("settles an acknowledged revert the provider did not keep, so the chat attaches and sends"); **target still present** after `prepared` → drop the record ("clears an unapplied prepared rewind after observing the target still present").
- **A crash between the journal commit and the `completed` record** → the existing epoch settles, never replaced twice ("settles the existing epoch after a crash between journal commit and record completion").
- **An item missing from a retained turn** → refusal ("rejects post-revert history missing an item within a retained turn"); **foreign/new row kinds** are kept as is (`structured-rewind-journal-body.test.ts`); **a chat event-sink failure** never fails the rewind ("rewinds after the chat's event sink failed, its error never failing the rewind").
- **Two concurrent cancels**: the second is refused by epoch. **A rewind of a resting chat** starts the agent. **Rewind past /clear**: only the suffix is rewritten, the prefix byte-for-byte and the epoch are kept; a suffix rewind and success roll back together on failure. `structured-agent-session-rewind*.test.ts`, `structured-agent-session-clear-rewind.test.ts`.
- **The key of a sent-but-unacknowledged message** → translated into the provider key (`structured-agent-session-rewind.ts`; test "resolves accepted codex user submissions to provider targets").
- **Client**: a confirmed rollback blocks submits until the new epoch arrives (120 s, then a message; a hidden pane stays silent); on `outcome-unknown` the message returns to the composer, and a duplicate counts as harmless. `use-native-chat-rewind.ts`.

## Claude rollback and resume point (though rollback is off)

- **Transcript reads at a fixed length**: one descriptor and one size for the whole proof; on `MarkerMissing`/`PreviousCursorMissing`/`TailIncomplete` — one retry if the file grew; `last-prompt` lags after a crash, so history tails from the file's last line. `main/claude/claude-transcript-branch-proof.ts`, `claude-transcript-branch-graph.ts`.
- **Resume point**: the cursor is the last finished turn; a failed write repeats at the nearest turn end; a `result` after the process exits does not count as a turn; the close-time write goes after the already-flying turn-end record. `main/claude/claude-structured-turn-resume-point.test.ts`.
- **SDK flags under watch**: `resume`, `continue`, `session-id`, `fork-session`, `resume-session-at`, `resume-drops-turn`, `no-session-persistence` and others must not be set by chat user arguments. `main/claude/claude-structured-launch-args.ts`.

## Fork over terminal text

- The scrollback capture is first trimmed from the end to 4× the budget, then cleaned of ANSI/OSC (otherwise a huge buffer costs several full passes); the markdown fence outlasts any backtick run in the text; an empty result → "No terminal context to fork". `renderer/src/lib/agent-session-fork-context.ts` and tests. Double submit in the dialog is blocked. `TerminalAgentSessionForkDialog.test.tsx`.

## What the reading does not establish

- The list comes from the files and test names read, not from all 1.8 MB of `config/reliability-gates.jsonc`: by headers it holds one gate about resume (provider-ownership); the remaining "resume" entries concern VM, system power, and SSH threads; no header mentions a fork or rewind gate of its own.
- `#NNNN`/`STA-NNNN` links were never read; the substance comes from the comments beside them.
- No case was reproduced: this is what Orca claims about CLI behavior and its own code.
