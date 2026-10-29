---
id: 01a10b71-faba-7e56-8109-21ae08141b1a
title: "Window: dictation into the agent field and the terminal — the `Dictation` service, input targets, microphone button, key, and the \"Voice input\" settings block"
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b70-624a-788b-ba2a-cbe616b50a26
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/speech
  - kind: dir
    ref: apps/tagma/app/src/lib/features/speech/dictation
  - kind: dir
    ref: packages/chat-ui/src
---
The "What the user gets" (except the indicator and global dictation) and "Window" sections of spec step 1. Start with `apps/tagma/app/src/lib/features/speech` (`Check.svelte.ts` already holds the `speech.recognize` feed), the composer in `packages/chat-ui` (`Composer.svelte`, `PromptField.svelte`), the terminal `features/executions/terminal/Input.ts` (`paste`). Done when the `Dictation` unit test passes, and smoke in Chrome and desktop shows dictation into the agent field and the terminal.
