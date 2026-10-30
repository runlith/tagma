---
id: 01a14c08-22b6-75de-88f8-5bef6fa09803
title: "The Claude Code and Codex account is the login of their official CLI: Tagma opens the login terminal and keeps no token"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928e44dc7c58
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf0948797f4
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf142804f17
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Heading.svelte
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/carry.ts
  - kind: file
    ref: packages/adapter-openai/src/harness/ends.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/defaultLogins.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessAccounts.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessSignIns.ts
  - kind: file
    ref: packages/adapter-anthropic/src/accounts.ts
  - kind: file
    ref: packages/adapter-openai/src/accounts.ts
---
**Value.** A Claude or ChatGPT subscription works in Claude Code and Codex threads the same way as in their own terminal, and Tagma neither holds nor reads their token.

**How.** The "Claude" or "Codex" section on the Providers screen in CLI-login mode: "Add account" opens a terminal with `claude auth login` or `codex login` right in the provider card, the card waits while the CLI logs in, and names the outcome in place — an account with its login label or an unfinished login with retry and the CLI output; only a link from the card leads to the shared terminal panel.

**Behaviour.** Each new account is its own CLI configuration directory under the Tagma directory; the address is stored spelling-exact. The existing user login (directory not set, `~/.claude` or `~/.codex`) is found on an addressed directory request or when starting a CLI thread: Tagma asks the chosen CLI itself whether it is logged in, without reading the token. After that, lists take an answer no older than half a minute, so a logout or account change in the terminal arrives on its own; merely installing the CLI does not start it. A run receives the chosen account's environment and cleared API keys, so the subscription pays. The thread line and menu name the account its CLI process stands on, and without a process — the thread's choice. A standing terminal CLI does not change the account itself: when the choice has diverged from it (the operator switched the default), the thread line names both, and a run that fell on a limit makes that mark primary. "Continue on <chosen>" — restarting the agent — raises the CLI on the chosen account with the same conversation: the vendor session moves to the new account's folder, and a run that fell on a limit continues; commands the CLI started break with it. A new login attempt's link to its terminal survives: after a server restart the account waits again for the CLI's actual end and receives its outcome. An explicit Cancel cancels exactly that attempt and finishes its terminal: a late successful answer will add no account. On reconnect the previous account and its login stay; the CLI directory is not deleted. Pressing Cancel does not hide the wait until the operation answers; on refusal the window names the reason and leaves the terminal and retry of the act available. Closing Settings does not count as a cancellation. Deleting an account removes only Tagma's record: the CLI directory and login stay. Claude Code is accepted only with a subscription login.

**Limits.** Login starts only from a project, because the terminal belongs to the project: it stands in the project root, otherwise the app would find no place for it and would not open it, and Claude Code waits in it for the pasted code. Without an installed CLI the section says it is not installed; installing from the section is idea [[ec51f8e4]]. Only a running session gives Claude Code quota ([[39bbe00b]]). Only the transcript carries over, the login is not copied; where carrying over is impossible the new CLI gets a retelling of the journal within the hook's context limit. Tagma learns of the limit refusal from Claude Code by its `StopFailure`, and from Codex by the error Codex closes its run with in its rollout (`task_complete` with `codex_error_info`, [[b828138c]]). Codex sends no Stop event on such a run, so the run ends when Tagma after a silence window (about a minute) sees an empty Codex prompt on the screen or when the next run starts. Only then does the limit mark become primary. A Claude Code account by API key, which spec [[52b10a62]] names as a separate account kind, is not made: the Anthropic key stands as a separate provider ([[7c1754fb]]). Devin as a CLI thread has no accounts in Tagma.
