---
id: 01a0c84d-7ae0-7d85-83fb-8f803839d7e6
title: "Motion options that are published, resolved and never read: `startYpx` by both variants, scale by the sheet, the offsets by the scale"
ord: 27
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a90d-739e-b053-727e5d33e95f
sources:
  - kind: file
    ref: packages/primitives/src/dialog/motion.ts
  - kind: file
    ref: packages/primitives/src/dialog/transition.ts
  - kind: file
    ref: packages/primitives/src/types.ts
---
`startYpx` is a published motion option that changes nothing. Measured 2026-09-22: it is declared optional on `DialogMotion['content']` (`types.ts:21`) and required on `DialogResolvedMotion['content']` (`types.ts:40`), carries a default of `0` (`dialog-motion.ts:13`), and is resolved for both variants (`dialog-motion.ts:37`). Those four lines are every mention of the name in the package — `dialogContentTransition` reads `easing`, `durationMs`, `startOpacity`, `variant`, `startInlinePercent`, `startXPercent`, `startYPercent` and `startScale` from the resolved content, and never `startYpx`.

So a caller who passes `motion: { content: { startYpx: 40 } }` gets a dialog that enters exactly as it would have without it, with nothing — not a type error, not a warning — saying the option was dropped. Its neighbours `startYPercent` and `startXPercent` do work, which makes the silence worse: the name reads like the pixel-valued member of a working family.

A second reading found the same shape twice more, variant-conditional rather than absolute, and the decision should cover all three together. `dialogContentTransition` reads `startScale` only on the scale branch and the positional offsets — `startXPercent`, `startYPercent`, `startInlinePercent` — only on the sheet branch, while `resolveDialogMotion` resolves every one of them for both variants and `DialogMotion` publishes them for either. So a sheet given a `startScale`, or a scale dialog given a `startYPercent`, is silently no different from one given neither. `startYpx` is the degenerate case of the same thing: dropped by both branches rather than by one.

Two ways out, and the choice is a product one. Either wire it into the transition beside the percentage offsets, translating pixels on the same axis; or delete it from both types and from the resolver. Deleting is the smaller change and nothing in the repository passes it — `apps/tagma/app` is the package's only consumer and names it nowhere. Whichever is chosen, confirm the package's own suite and typecheck stay green.
