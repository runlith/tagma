---
id: 01a0ca7c-e700-7fbd-8e1b-abd020873442
title: ChatFold's cut methods have no callers in the repository
ord: 175
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
ChatFold.interruptRun, supersedeRun and clearRunQuestions (packages/chat-ui/src/ChatFold.svelte.ts:167-188) have no callers anywhere in the repository — only the suite drives interruptRun, and the kernel's turns.interruptRun is a different function. The turn protocol that should cut runs never reaches them. Decide whether they are product API awaiting its caller (then say who calls them), or dead surface to remove; if the turn layer should call them, that is a separate wiring change.