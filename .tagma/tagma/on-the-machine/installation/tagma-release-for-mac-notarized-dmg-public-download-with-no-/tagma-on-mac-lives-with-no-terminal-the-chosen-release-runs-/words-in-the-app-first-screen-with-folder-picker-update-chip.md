---
id: 01a13c9b-c2eb-7fa3-95cc-fb7ce00dc24e
title: "Words in the app: first screen with folder picker, update chip without commands, sound, dictation and update refusals in human words, \"Open Settings\" on permission denial"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae3-7f61-9eb3-0f8dfbe17c55",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
---
Rule 5 of [[1c89545b]] in the app surface (`apps/tagma/app`) and with refusal owners on the server; the waiting page is the window's task.

- First screen without projects (`app/chrome/Start.svelte`, new-project dialog): folder picked with the system dialog, no "from the terminal" and no typed path.
- Update chip (`app/chrome/StandingChip.svelte`, `Standing.svelte.ts`): number, size, "Update", "Go back"; no `tagma status`, command echo, "Copy log path" or `$`-prefixed line.
- A refusal on a human press — in its words: what failed and one action; code, `unblock` and details under "Details". The refusal owner declares the words next to the refusal in its operation's wire, no central dictionary. In scope: calls and recording (`capture-refused` and sound-helper refusals — `packages/audio/src/helper/session.ts`, `client.ts`), dictation, update and rollback (`release-channel` runner, offers), `contract-apart` in `app/src/lib/wire/Door.ts`. Refusals inside agent threads stay as they are.
- `permission-denied` for the microphone: "Open Settings" button on the "Privacy → Microphone" page; dictation Accessibility the same.

Done: each listed refusal shown on its own server instance in words and with an action; no tests for wording — checked by eye and screenshots in the report.

Not proven: live capture refusal (`capture-refused`, TCC) — the server refuses earlier with `no-model` without a recognition model; channel chip — the dev instance offers builds, not releases; natively in Electron unverified: native folder picker, "Open Settings" (`window.open` → `setWindowOpenHandler` → `shell.openExternal`), Reload on `contract-apart` and showing the main window from the global-dictation pill: a window from checkout while the operator's Tagma Dev runs would hand itself to its window (single-instance), and there is no isolated window launch.
