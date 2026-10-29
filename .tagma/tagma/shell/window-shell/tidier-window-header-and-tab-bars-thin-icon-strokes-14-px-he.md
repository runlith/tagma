---
id: 01a15acf-0a1e-7276-a2da-129ec6c1eb6e
title: "Tidier window header and tab bars: thin icon strokes, 14 px header icons, 12 px tab text, light counters, right tabs as a pill"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a108a9-89cf-7f17-9b45-3b4c55b5437b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/TabRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/button/button.svelte
---
The operator compared Tagma's header with Codex: ours is big and crude. Measured on his screenshots (same scale): icon strokes 1.3 px versus 0.85 at Codex, header icons 14–15 px versus 11–12.5, tab text 13 px versus 12, the counter next to the icon semibold with a 6 px gap. The font is not the cause: Geist and SF Pro match in width and letter height.

The operator decided:
- all lucide icon strokes 1.5 instead of 2 — one setting at the app root;
- header and tab-bar icon buttons 14 px instead of 16 (standard [[69cfbc5c]] set 16 for the header — replaced by the operator's word);
- tab text `text-small` (12 px) in every tab bar;
- Changes, terminal, and page counters in regular weight, 4 px gap from the icon;
- right-area tabs as a pill (`look="pill"`), no vertical lines.

The palette stays unchanged — a separate decision of the operator for later.

Thirteen copies of the quiet icon-button class collapse into one `quiet` variant of the shared `Button`.

Proof: app typecheck and before/after snapshots of the header, right tabs, and bottom terminal panel on a separate `tagma:try` instance.
