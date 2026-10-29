---
id: 01a13d48-9aa9-71d0-a2d8-6904612a8cec
title: "Theme without mode-watcher: own module, same storage key, applied before first paint, switching without an animation wave"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/app.html
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
---
- **Own app module outside the Layer graph** — `$lib/shared/theme.svelte.ts`. The theme is also needed by routes outside the app: `/pair`, `Refused` (`routes/+layout.svelte`).
- **Windows of one profile** hold one choice: a change in one window reaches the others via the `storage` event, as with mode-watcher (its `PersistedState` from runed syncs tabs).
- **Storage.** The preference is stored in localStorage under the `mode-watcher-mode` key; values `light`, `dark`, `system`. Key and values are the same as mode-watcher writes, so each copy's choice survives without migration code. The script in `app.html` and the module read this one description. The module cannot be imported from `app.html`, so the format is kept here.
- **Resolved theme** `light | dark` is reactive. While the preference is `system`, it follows `prefers-color-scheme`. Applied via the `dark` class and `style.colorScheme` on `<html>`.
- **Before first paint** the saved theme is applied by the script in `app.html`.
- **Switching.** Transitions and animations are disabled for the duration of the switch so a theme change does not trigger them across the window. That is what mode-watcher did.
- **Consumers:** `app/chrome/actions.ts`, `app/chrome/AppMenu.svelte`, `features/views/ViewFrame.svelte` (passes the theme to plugin views), `routes/+layout.svelte`.

**Performer check** (unit):
- `system` resolves via media query and follows its change;
- the choice is stored under the same key and sets the class and `colorScheme`;
- a value written by mode-watcher reads as is.
