---
id: 01a16896-f474-7dbd-a7e8-99a7a6452b90
title: The rail's and thread header's own icons draw on a 16 grid with a 1 line — the same weight as Lucide
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15acf-0a1e-7276-a2da-129ec6c1eb6e
  - kind: relates
    to: 01a165f0-b92e-7022-bbac-5ddefb22bd2d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/AgentIcon.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/Glyph.svelte
---
Custom icons stand where the thing itself is named: rail places, thread-header buttons, their tabs and "open beside" items. Common to all is only the `Glyph` frame: a 16 grid, `round` ends and joints. The drawing is a separate component at the feature owning the place: `KnowledgeIcon` and `JournalIcon` at the graph. The feature puts it into its place's `icon`, and the rail, "more" and the palette draw what they received. Shapes grow from a soft square: nodes, blocks and dots are rounded squares, not circles, frames round 1.25.

Agents, the rail's home, is drawn as the Tagma helm (`AgentIcon`) in the place's one colour. The helm gets the gold front tile only via `brand` — where it is the sign of Tagma itself: the start screen, the installation window title (`StandingChip`), and where it means the Tagma agent — "New agent", the draft's agent picker, the block author. On the rail gold would have burned even when Agents is not the current place, and gold means "you are here".

The line scales with the icon. One unit in the 16 grid gives the same weight as Lucide with `stroke-width: 1.5` in a 24 grid (the `.lucide-icon` rule in `app.css`): 1 px at 16 px and 0.875 px at 14 px. The operator picked the Lucide weight after comparing with Codex ([[c6c1eb6e]]). Whoever changes it changes `Glyph` too, otherwise custom icons in tabs and menus will stand thicker or thinner than Lucide.

The current place is marked by colour and button backing, not by filling the drawing: drawings of lines only — menu, "more", branch — would barely change when filled.

Settings sections, the mobile shell and all other icons stay on Lucide. Changes, pages and calls draw straight Lucide `file-diff`, `file-text` and `headphones`: the operator picked them over custom drawings after comparing on a mockup.
