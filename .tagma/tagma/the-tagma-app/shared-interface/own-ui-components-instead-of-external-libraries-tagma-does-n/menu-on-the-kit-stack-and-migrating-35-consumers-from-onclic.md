---
id: 01a14b1b-14eb-75f6-a49c-491126cc916f
title: Menu on the kit stack and migrating 35 consumers from `onclick` to `onSelect`
ord: 22
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-690292e227b7
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490cfb3764ac
---
Build the [[92e227b7|menu]]: items, checkboxes, radios, a submenu with an intent zone, a context menu, drag-through; migrate the wrappers, three direct bits imports, and items with `onclick`.

Done when: the spec's unit tests pass, the `CheckoutPage` and `Group` tests are green, `shared/ui/dropdown-menu` has no bits, commit.
