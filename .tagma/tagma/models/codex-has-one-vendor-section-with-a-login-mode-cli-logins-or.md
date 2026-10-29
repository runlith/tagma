---
id: 01a14c08-22b6-75de-88f8-5bf0948797f4
title: Codex has one vendor section with a login mode — CLI logins or Tagma's own login
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf142804f17
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/Group.svelte
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/modes.ts
  - kind: file
    ref: packages/adapter-anthropic/src/adapter.ts
  - kind: file
    ref: packages/adapter-openai/src/adapter.ts
---
**Value.** The operator chooses whose login signs Tagma's own path to the vendor model, and sees one vendor account list instead of two.

**How.** The "Sign in with …" switch in the section header next to "Add account"; the `select_account_mode` operation.

**Behaviour.** The mode decides whose accounts stand in the section, what "Add account" does (a CLI terminal or a browser login), and what signs Tagma's own path requests. Switching deletes nothing: the other mode's accounts return with the mode. The first showing picks the mode itself: if the provider already has Tagma's own logins — the Tagma mode, otherwise the CLI login preferred by the adapter, if the CLI is installed. A mode with no installed CLI is unavailable and explains why. The choice lives in the machine file; if it could not be written, the section says "Sign-in mode not saved". Claude Code and Codex in the model menu follow their own login in any mode.

**Limits.** Tagma mode at Codex logs in with the Codex CLI client id.
