---
id: 01a1b229-3260-7072-a257-af0771d9724c
title: A browser profile chooses human input or fast development access
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046f00d856ce
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/profile.ts
  - kind: file
    ref: apps/tagma/server/src/browser/profiles.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/act.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
---
**Value.** A profile selects the interaction contract for all callers, so pages used for ordinary browsing do not acquire development diagnostics merely because an agent visits them.

**How.** `create_profile`, `update_profile` and `list_profiles` carry the profile's `input` mode: `human` or `fast`.

**Behaviour.** New profiles and the desktop user profile use human input; the built-in agent profiles use fast input. Human mode uses paced pointer, keyboard and wheel events, clears fields with the keyboard, and preserves its pointer position across engine reconnects. It refuses page scripting, console and network inspection, device emulation, tracing, audits, heap capture, framework source inspection, direct option writes, file assignment without an observed chooser, and full-page captures that resize the rendering surface. A human upload clicks a visible chooser control before supplying the chooser's files; selection uses native keyboard type-ahead or clicks an accessible custom listbox option. The refusal names the profile and the mode change that enables the requested diagnostic. Switching modes ends the old engine session before subsequent work attaches, clearing its device conditions; a human profile never enables Runtime or Network capture, even when its console preference requests it.

**Limits.** Human input does not guarantee how a site classifies a browser or what an account service permits. Viewport and visible-element screenshots, PDF, accessibility snapshots, navigation, waiting and ordinary input remain available. Native focus is emulated without activating the operator's window so keyboard input reaches the page; device identity and viewer layout are not emulated in human mode. The normal screencast forwards the operator's own events as received. Human selection needs one choice, a keyboard-reachable native control with a unique supported prefix, or an accessible custom listbox. Multiple selections, native labels without such a prefix, directory picking, clearing a file input directly and upload controls that open no chooser are typed refusals.
