---
id: 01a18513-686f-7a71-95ba-89703787b73c
title: submit_work treats patched node_modules declarations as commit dependencies
ord: 145
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held for ScrollBehavior and key in node_modules/.bun/@tanstack+virtual-core@3.19.8/node_modules/@tanstack/virtual-core/dist/esm/index.d.ts, held by nobody, and directed inclusion of that ignored installed file with whole.",
    "command": "submit_work(paths: [\"packages/chat-ui/src/TranscriptViewport.svelte.ts\", \"packages/chat-ui/src/TranscriptVirtualizer.svelte.ts\", \"packages/chat-ui/src/TranscriptViewport.svelte.test.ts\", \"packages/virtual-list/src/VirtualList.ts\", \"packages/virtual-list/src/correction.test.ts\", \"patches/@tanstack%2Fvirtual-core@3.19.8.patch\", \"patches/@tanstack%2Fvirtual-core@3.19.8.hunks.json\", \"bun.lock\"], whole: [\"bun.lock\", \"patches/@tanstack%2Fvirtual-core@3.19.8.patch\"] )",
    "expected": "Land source changes and the package-manager-generated dependency patch; ignored installed dependency declarations are not required commit paths."
  }
---
Filed from project `tagma`.

The durable Bun patch adds isScrollWriteBlocked to virtual-core's declaration files and is already included in the selected patch artifact. ScrollBehavior and VirtualItem.key are unchanged registry declarations. bun install had just completed. The proposed recovery would carry an installed dependency file rather than the patch artifact.