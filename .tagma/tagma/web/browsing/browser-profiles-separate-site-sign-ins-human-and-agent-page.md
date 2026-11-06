---
id: 01a14c08-1c3f-7bde-a2e3-046f00d856ce
title: "Browser profiles separate site sign-ins: human and agent pages get their own profiles by default"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04706355b04b
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04710dac7353
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0476d576a8a6
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/section/ProfileRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/section/Section.svelte
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/profileOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/browser/profiles.ts
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/adapter.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/adapter.ts
---
**Value.** Human and agent sign-ins do not mix: each profile keeps its own cookies, storage, and cache, and human and agent pages go to different profiles by default.

**How.** Settings → Browser: the `browser.userProfile` and `browser.agentProfile` settings (per user and per project), a profile list with rename, clear, and delete, and adding a profile. The `list_profiles`, `create_profile`, `update_profile`, `clear_profile`, and `delete_profile` operations are for any caller.

**Behaviour.**
- Profiles are machine-scoped, like provider accounts. Seeded with "You" and "Agents" on desktop and "Agent (managed Chromium)"; a profile stays bound to its host adapter forever. New profiles and "You" use human input; the two built-in agent profiles use fast input. Any caller can change the profile's input mode through `update_profile`.
- Clearing closes the profile's pages and wipes cookies, storage, and cache; deleting removes the profile with its pages. When the profile's host is disconnected, wiping waits for it to connect (`pending`).
- A default profile whose host is disconnected refuses to open a page instead of substituting another: a refusal, not a fallback.

**Limits.** The settings screen creates a profile on one of the adapters of the profiles already standing, with the default document; only `create_profile` with a document picks the "installed Chrome" build. Proxy, fingerprint spoofing, groups, and moving profiles between machines are [[d576a8a6|promised]].
