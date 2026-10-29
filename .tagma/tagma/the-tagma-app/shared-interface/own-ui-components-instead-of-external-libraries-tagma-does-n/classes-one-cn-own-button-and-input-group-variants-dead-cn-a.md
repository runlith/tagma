---
id: 01a14b1b-14eb-75f6-a49c-490a2fc898d8
title: "Classes: one `cn`, own button and input-group variants, dead `cn` and `lucide-svelte` go away"
ord: 15
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-6905826b7939
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-4908938272c2
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/utils.ts
---
First part of [[826b7939|classes and variants]]: everything except shadcn css and `tw-animate-css` (the last task removes them). `DialogHost` receives classes from the app.

Done when: `tailwind-variants`, `primitives/cn.ts`, `utils/class.ts`, and `lucide-svelte` are removed, `bun check` and token checks are clean, commit.
