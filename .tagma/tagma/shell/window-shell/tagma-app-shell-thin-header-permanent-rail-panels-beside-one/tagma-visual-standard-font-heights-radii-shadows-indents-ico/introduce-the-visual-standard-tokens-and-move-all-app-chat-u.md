---
id: 01a108a0-1765-74f2-b42a-3d570325278f
title: Introduce the visual-standard tokens and move all app, chat-ui and primitives visuals onto them
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a108a0-ed1d-7f8b-8537-c6ac58020a27",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10891-853e-7f52-89f5-9e2869cfbc5c
---
Build everything under [[69cfbc5c]] except the check:
- tokens and Tailwind family resets in `apps/tagma/app/src/app.css` for both themes, including the tone ladder and `--chrome`;
- reconfiguring shadcn components in `lib/shared/ui`;
- `PageHeader` and the two page widths;
- migrating font, heights, radii, shadows, indents, icons and colors in `apps/tagma/app/src`, `packages/chat-ui/src`, `packages/primitives/src`.

Done when:
- a one-off DOM scan across sections yields only standard values;
- typecheck and tests pass;
- before-and-after shots of every section in both themes are ready for the operator.
