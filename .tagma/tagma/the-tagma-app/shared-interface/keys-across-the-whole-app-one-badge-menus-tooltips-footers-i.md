---
id: 01a15f40-652a-7997-8052-f70678cac4f5
title: "Keys across the whole app — one badge: menus, tooltips, footers, in-field hints and text"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15c80-45a4-7400-9098-f51b45bd186d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15e63-7468-75bb-847e-0bbec70a2394
---
The operator picked option K1 from the http://localhost:5634/a/88d93654cccd page ("New · 4" chapter): a key is a `bg-selected` tile with no border, a separate badge per chord key, two sizes matching neighboring text.

Right now there is no key component: every screen writes it its own way — gray text in `DropdownMenu.Shortcut`, through `stamp`, bordered or not, a bare symbol in text and in the native placeholder. One component is needed, and every place moves to it: menus, tooltips, palette and picker footers, the pending-words drawer, the input hint during a run, the commit field, prose hints. Key spelling comes from `chordSpelling.ts`, so on Windows and Linux the badge shows words, not macOS glyphs. Follow-up queue dragging doesn't enter here.
