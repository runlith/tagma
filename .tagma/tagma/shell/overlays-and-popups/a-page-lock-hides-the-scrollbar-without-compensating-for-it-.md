---
id: 01a0c857-a004-761d-a8e1-2443c66f008b
title: A page lock hides the scrollbar without compensating for it, unlike the fixed lock beside it
ord: 29
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a919-7de5-854d-9cd001efd39b
sources:
  - kind: symbol
    ref: packages/primitives/src/dialog/scroll-lock.ts
    symbol: applyFixedLockStyles
  - kind: symbol
    ref: packages/primitives/src/dialog/scroll-lock.ts
    symbol: applyPageStyles
  - kind: symbol
    ref: packages/primitives/src/dialog/scroll-lock.ts
    symbol: lockPageScroll
---
The fixed treatment compensates for the scrollbar it removes and the page treatment does not, though both hide the same scrollbar.

`applyFixedLockStyles` measures `innerWidth - document.documentElement.clientWidth`, publishes it as `--runlith-scrollbar-compensation` on `html`, and pads the body by it when positive. `applyPageStyles` sets `overflow-y: hidden` and `overscroll-behavior-y: none` on both `html` and `body` and measures nothing. A page lock held alone off iOS takes the second path, so on any platform with space-taking scrollbars — Windows, most Linux, macOS with "always show scroll bars" — the document loses the scrollbar's width and everything in it shifts sideways for as long as the lock is held. The fixed path exists precisely because that shift was worth preventing.

Two measurements bound how much this costs today, and both belong in the decision. `lockPageScroll` is exported from `src/index.ts` and called by nothing: not inside this package, where only `dialog-root.svelte` takes a lock and it takes the dialog kind, and not in `apps/tagma/app`, which is the package's only consumer. And `--runlith-scrollbar-compensation` is read by no stylesheet in the repository — the fixed path publishes a number nobody consumes, so even the compensation that exists is doing half its job: the body padding lands, the custom property is inert.

So this is a latent defect rather than a live one, and the first caller of `lockPageScroll` is who it will bite. Either compensate in the page path as the fixed path does, or decide deliberately that the page path does not need to and say why. While that is being decided, settle whether `--runlith-scrollbar-compensation` should be consumed by a stylesheet or dropped, and whether `lockPageScroll` is surface this kit still wants to publish.
