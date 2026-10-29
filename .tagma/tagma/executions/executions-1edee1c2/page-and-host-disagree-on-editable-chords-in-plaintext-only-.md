---
id: 01a0cae0-1ccb-7e59-9775-941699f99290
title: "Page and host disagree on editable: chords in \"\" / plaintext-only editors are eaten"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d56b-ca68-7171-9c36-241f3767a4d0",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/PaneHost.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/TerminalsPage.svelte
---
The terminals page and the pane host disagree on what counts as an editor: `pageOwnsKey` excepts only `.xterm` plus `input`/`textarea`/`[contenteditable="true"]` (`TerminalsPage.svelte:13-17`), while the host gate treats `""`, `true` and `plaintext-only` as editable (`TerminalPaneHost.svelte:3-13`). A chord pressed in a `""` or `plaintext-only` editor is therefore claimed and `preventDefault`ed by the page instead of reaching the edit.

Unify the two gates on one editable test. Done when chords in every editor the host recognizes reach the edit, with a test pinning the `""` case.