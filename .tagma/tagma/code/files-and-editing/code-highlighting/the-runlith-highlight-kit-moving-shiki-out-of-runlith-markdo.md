---
id: 01a117f3-5a65-7f0d-9926-2e00beee05c9
title: "The @runlith/highlight kit: moving shiki out of @runlith/markdown and sessions for the document being edited"
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3f4413c99cc
---
What to do: move `codeHighlight`, `highlightOffThread`, `highlight.worker` from `packages/markdown/src` into a new `packages/highlight`, move consumers (`render.ts`, `CodeBody.svelte`, `AuthoredDiff.svelte`, `Conversation.svelte`, `markdown.ts`, `CodeTheme.svelte.ts`) to the new kit, then add sessions on `@shikijs/vscode-textmate` and `LineEdit` from `@runlith/files/lines`.

Where to start: [[413c99cc]]. Proof: the spec's acceptance — session contract tests, typecheck, affected package tests, `check_rules over: change`.
