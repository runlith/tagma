---
id: 01a10ce2-6ef8-7265-8af0-b80b82c93830
title: "Settings — a shell surface: rail gear, a section column with its own scroll, content with a sticky header and the section layer, compact rows"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/settings
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Columns.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
---
Settings become an ordinary shell surface: a gear at the rail bottom, a section column with its own scroll, content with its own scroll and a sticky header. The operator's 2026-10-05 decision on the "Settings redo" page (http://localhost:5634/a/de7ad4502768): option A, the layer picked by a switcher in the section header (A1).

## Why

Read off the code and the operator's snapshot (a window around 1430×1000):
- the rail has no entry: the gear left the header in `92803dcb`, leaving ⌘, and the app menu;
- the page is a `page-wide` document with its own header and layer tabs; the section rail is sticky but taller than the screen (22 sections, about 1000 px), and its bottom shows only at the end of a long section;
- the layer tabs stand far from the rows, and switching dims up to 50% of another layer's sections;
- eight server sections aren't declared in the app and sit in "Other" with a robot icon;
- a settings row takes 100–160 px: a title with a key, a description and a "Set for … · by … · Reset …" line, with the picked option's caption under the control.

## What the operator gets

- **Entry.** A gear at the rail bottom above the column button, highlighted on `/settings`; ⌘, works as before. With no `section` in the address the last opened section opens.
- **Column** like Agents: a title, `/` filter, Agent, Project, Machine, Interface groups, its own scroll, the width stretches by seam, ⌘\ and the rail button hide it. Under the active section stand its key groups: the current one highlights on scroll, a click scrolls to it. A section carries a quiet digit — how many keys are set on the shown layer.
- **Filter** narrows the section list by name and by keys; while non-empty, the content shows the found keys by section.
- **Content** scrolls itself. A sticky 48 px header: icon, section, current key group, layer. Reading width is `max-w-reading`.
- **Layer.** The "project / Every project" switcher stands only at a section whose keys take both layers. A single-layer section opens on its own, whatever stands in the address, and carries that layer's badge; a local section is "This machine" or "This browser". Nothing dims in the column, the "decided for …" banner goes away.
- **Row** around 56 px: name and description on the left, control on the right. A value set on the shown layer is marked by a stripe on the left, its hint saying who set it. Copy and reset on a key appear on hover and focus. The picked option's caption is the description's second line. A server refusal, an unreadable value, overlap by another layer and a key lock on another layer stay in the row.
- **Key group** with no frame: a title and rows over a thin line.
- **Narrow window.** Where the column has no room, it doesn't render, and the section is picked from a menu in the header.

## Mechanism

- Only the app changes; the server and the key catalog stay as they are.
- Every module declares its sections in its own `settings.ts`, as now. Appearance (shell), orientation, rules and enforcement (rules), command (executions), power, checkout (Git), worktrees are added. `SectionGroup` is agent, project, machine, interface. A section the app doesn't know still lands in "Other" at the column end, so a new server section never vanishes.
- `SettingsColumn` is an app-level service next to `AgentsColumn`: whether the column is open and which section opened last, in local storage. `Columns` gives the column by route, and the rail and ⌘\ take it from there.
- `Group` is a key group's title and rows. It registers its title in `SettingsParts` from the page context, and the column draws the section's groups and scrollspy from them. `KeyCard` renders through `Group`.
- A section's layer is derived by `scope.ts` from the section's keys: which layers it takes and on which it opens.
- The column width is the `settings` pane in `Panes`.

## Acceptance

- At 1440×900 and 1280×720 the column shows whole or scrolls itself, the content scrolls separately, the section header stands put.
- The gear and ⌘, go to the last section; ⌘\ hides and shows the column.
- The column has no "Other", no robot icon and no dimmed sections.
- Power and Telemetry open on their layer with no banner; Agent switches between project and Every project.
- `?key=` scrolls to the row and highlights it.
- Every section is walked with snapshots in both themes; the app typecheck and tests pass.
