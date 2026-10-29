---
id: 01a14c14-6895-75c6-80f2-47b0b84c2d57
title: Terminal styling — font, theme from the catalog, cursor, transparency, padding, and separators — changes in settings and applies to every open panel at once
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/appearance/Settings.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/RenderPolicy.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/TerminalSection.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/terminalAppearance.ts
---
**Value.** The operator tunes the terminal to their own, like a standalone emulator, and sees the result at once, without restarting panels.

**How.** Settings → Terminal: Typeface, Theme, Pane, and Use cards; `terminal.*` keys per user or project.

**Behaviour.**
- The theme is picked from the catalog separately for the window's dark and light mode; individual ANSI, text, background, cursor, and selection colors override on top of the theme.
- Tagma Dark and Tagma Light are the defaults: the terminal background is the thread background color, the cursor and selection are the brand color, so the terminal in the bottom panel and in the feed does not stand out as a patch of foreign color.
- Font, weights, line height, ligatures, cursor look, blink and transparency, background transparency, active and inactive panel transparency, padding, and separator thickness and color apply to every open panel at once.
- Font size is the starting size for each panel; each panel scales separately with keys.
- Rendering goes through WebGL where available, falling back to DOM; the key sets the policy.

**Limits.** Styling belongs to the window: the screen the agent reads does not depend on it.
