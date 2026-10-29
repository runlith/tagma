---
id: 01a12f43-b31c-76a9-adf5-158f6c313afd
title: "Providers screen: one section per vendor with the sign-in mode in the header (Codex: Codex login / Tagma; Claude: Claude login), no import"
ord: 9
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Follow the spec's "Sign-in mode and vendor section" section. The CLI sign-in server chain already exists (`d4c3eb2fff`); Codex borrowing is `4a9b8be68f`, duplicate merging `fb4881345e`, `de153ec53c`.

What to do:
- contract: the adapter declares the vendor provider's sign-in modes (values, default) as an adapter setting; Tagma stores the choice and gives it to its own path (`BorrowingTokens` / token store take only the selected mode's accounts) and to the screen;
- screen: one "Codex" section and one "Claude" section instead of "X" / "X · Tagma sign-in" pairs; a "Sign in with … ▾" switch in the header when there is more than one mode; "Add account" per mode; first show per machine (see the spec), including "Sign in with ChatGPT" without `codex` and the inactive Codex variant;
- Claude: in public, one mode with no switches;
- remove CLI-login import (`importLogin`, "Found on this machine", the `imported` origin wherever it exists only for import) — no legacy, migrate data once;
- simplify the section: Cache into a hint on the name, "updated ↻" into "⋯", no default/imported badges, one action per row and only when needed.

Done: on a separate instance (`tagma:try`, its own port and root — `tagma` commands only with `TAGMA_PORT`/`TAGMA_DATABASE_PATH`/`TAGMA_INSTALL_ROOT`) screenshots: Codex in both modes and switching; Codex without an installed `codex` (no PATH entry); the owner's mode-contract tests.
