---
id: 01a17e4c-13fe-78eb-a310-2ebe08c44611
title: "Account switch reaches live threads: an SDK thread moves at the nearest step, a terminal CLI on the operator's action, and the thread shows the actual account"
ord: 150
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10a41-1b43-775c-a6ea-957a076a4c60
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
  - kind: relates
    to: 01a17380-dc5b-7190-b69f-80b6e412e558
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/alignment.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/launch.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/moves.ts
---
**Why.** The operator holds several subscriptions of one vendor. When one quota window runs out, they switch the default account and expect the working agents to continue on the new one. Today a CLI process launched earlier keeps the old account's login folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) for its whole life, launch pin `session.account` returns the old account even on a restart of the same session (`accountFor`: `held?.key ?? selection?.account`), and the thread row shows the app-computed selection (`modelSettingsOf`: `basis.pinned ?? signerOf(rows)`) instead of the actual account. Outcome on 2026-10-27: nine SDK threads and five terminal ones stood on the exhausted account, receiving 429 "session limit", while the thread menu named the new account. The decision in [[076a4c60]] "a default change never moves an already pinned process" is revoked by this spec on the operator's word of 2026-10-27.

**What we do not do.** We never swap the token in a running CLI's login storage. Orca did that until PR #24434 (2026-10-08) and removed it: Claude Code itself rotates its one-time refresh token, a planted copy goes stale, login breaks, and keeping copies in sync "can't be made race-free, because a running Claude keeps renewing its login". Login and token refresh stay with the CLI. Tagma never switches to an account the operator did not pick: probing subscriptions to dodge a limit is a contract risk for every user. Devin is outside this spec.

**Rule.** A thread's selection is the account pinned to the thread, otherwise the provider default. The actual account is the one the process stands on (`session.account`). A thread following the default spends the current default; a pinned one spends its own.

**SDK/ACP threads** (Claude via the Tagma runner; the mechanism is shared for hosted profiles). Tagma holds their commands, the CLI process only talks to the model, so replacing the process interrupts nothing.
- A default move (`defaultAccountMoved`) touches every live thread of this provider that follows the default and whose process stands on a different account. With no turn running, the process is freed at rest and the launch pin removed; the next turn rises on the new account, the vendor session via `session/load`, or — when missing in the new folder — a fresh session from the journal (the existing road). With a running turn, the same owner that carries an explicit account switch moves the turn (`carryModelMove` → `HarnessMoves`): stop at the nearest step boundary, free the process, continue the saved work on the new account, with no interruption line in the feed.
- A turn that ended with a limit refusal (the `rate-limit` family) on the account the thread now moves away from continues on its own after the switch. A turn stopped by the operator does not continue.
- An explicit change of the thread's pinning already carries the turn — we do not touch it.

**Terminal threads** (Claude Code and Codex in the TUI). The CLI itself launches commands as children of its process, and "its work is done" cannot be told reliably from the process tree: a dev server never ends, a detached process (`nohup`, `setsid`, `docker compose up -d`) is invisible in the tree, and each CLI has its own service children (Claude Code's `mcp-serve`). So the terminal thread itself never moves to another account.
- As soon as the thread's selection diverges from the actual account, the thread row names both: which account the process stands on and which is selected. A turn that failed on the limit makes this mark the row's main one.
- A single "Continue on <selected>" action: the CLI rises on the selected account with the same conversation, and the turn that failed on the limit continues. Input to the terminal is not blocked. The CLI's commands are cut off at that point — that is the operator's decision, and the action's hint says so.
- "The same conversation" is the vendor session itself, carried into the new account's folder, not a retelling. Today, on a foreign account, alignment yields a new session with a Tagma record at the hook's context edge ([[e412e558]], `ALIGNMENT_WORDS.account`) — for a long thread that is a truncated retelling. History in Claude Code and Codex is not tied to a login (Orca shares it across account folders), so the transcript is carried over, followed by the usual Keep/Cut. Where carrying is impossible, seeding stays.

**Visibility.** The row and menu of every thread on a harness show the actual account of the process the server reports; with no standing process — the selection.

**Acceptance by the implementer** (test through the same door as the real call: `set_default_account`, `restart_thread`, or the new action):
1. SDK thread on A with no turn, default A→B: the next turn runs with a process in B's folder, `session.account` = B, the conversation continues.
2. SDK thread with a running turn, default A→B: the turn stops at a step boundary and continues with a process on B; the thread's command launched before the switch keeps running, and its end still reaches the thread.
3. SDK thread whose turn failed on A's limit, default A→B: the turn continues on its own on B. A thread pinned to A and a thread stopped by the operator are left alone.
4. Terminal Claude Code and Codex on A, default A→B: the process is untouched, the thread row names A and the selected B; the action raises the CLI on B with the carried vendor session, the model sees the whole previous conversation, the failed turn continues.
5. Thread rows and menus show the actual account.
