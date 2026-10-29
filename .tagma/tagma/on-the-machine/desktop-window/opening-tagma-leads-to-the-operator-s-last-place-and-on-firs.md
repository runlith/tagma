---
id: 01a13c76-28d8-728a-ab05-deee44e158a3
title: Opening Tagma leads to the operator's last place, and on first launch to a new chat — no empty screen
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c70-5421-74e5-8847-4ddc4c54f6fb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Visits.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/routes/+page.ts
---
Opening Tagma (desktop or a bare address in a browser) brings the operator where they were, and on first launch to a new chat; there is no empty screen.

**Now (measured 2026-10-14, build cb91ec0, clean localStorage):** `/` stays an empty shell — rail, header, empty middle. `Start.svelte` navigates to the project with `goto` from `$effect` during SvelteKit's first navigation, and that navigation is lost: `history.replaceState` with the project address is never called. Desktop always loads `/`, so after restart and after an update (`reopenIn` → new Tagma.app) the operator sees an empty screen instead of the thread.

**Do:**
- The `/` entry is decided by `+page.ts`: it waits for the `Workspace` project list and answers `redirect` to the last project place; the `Start` page remains only as the “no projects” empty state.
- `Visits` remembers each project's last section, and entry leads into it with its place and branch (thread X in Agents, a rule in Rules…); with no memory — Agents, new chat.
- Desktop flushes DOMStorage to disk before `app.exit` when reopening in another app, so the last place is not lost on update.

**Proof:** on the built surface with clean storage `/` opens `/<project>/chat`; after opening thread X and reopening `/` — `/<project>/chat/X`; app and desktop typecheck.
