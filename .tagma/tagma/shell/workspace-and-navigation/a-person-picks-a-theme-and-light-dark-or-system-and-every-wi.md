---
id: 01a14c05-9e8f-7c75-a633-b2a91727a3f5
title: A person picks a theme and light, dark or system, and every window on every device follows it
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/appearance
  - kind: dir
    ref: apps/tagma/server/src/appearance
  - kind: file
    ref: apps/tagma/app/src/app.html
  - kind: file
    ref: apps/tagma/desktop/src/appearance.ts
---
**Value.** A person makes Tagma look their own once, and every window on every device follows. Failure stays red, waiting and change blue, done green, work amber and here gold whichever theme stands.

**How.** The Theme row of the rail menu, the palette's Theme and Appearance entries, Settings → Appearance, and **Use** on a theme plugin's card. Themes beyond Tagma's own come from plugins. The Appearance section offers to find one or to have an agent make one.

**Behaviour.**
- The theme and the light, dark or system choice are the person's settings, so a change in one window paints every window at once. System follows each device's own light or dark.
- A theme that comes in one look only is shown in it whatever the choice, and the menu says so.
- A plugin theme that gives a state colour another meaning fails its build and its install, naming the colour.
- A theme an agent makes for the person lands among the person's own plugins, outside every project, so it reaches no project's commits and follows them into every project.
- A plugin's card lists its themes even while the plugin runs nowhere; **Use** on such a theme runs the plugin in all the person's projects and chooses the theme.
- When the chosen theme's plugin goes away, windows paint Tagma while the choice stands, Settings offers to use Tagma, and the theme paints again when it returns.
- A window opens in the look it last painted, before its code runs.
- The terminal follows the theme unless the person picks a terminal theme, and framed views receive the theme's colours. On desktop, native dialogs, the window frame and the pages' light or dark follow the painted look.

**Limits.** Tagma ships only its own theme, and a theme sets colours only. Pages agents write and other sites keep their own design. A device that never painted shows Tagma until the person's settings arrive.
