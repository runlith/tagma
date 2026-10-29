---
id: 01a10937-6ddd-7b5a-a22f-0bf1a4f2bae5
title: Introduce state tokens and bring all menus, popups, cards, dialogs, tooltips and buttons to one design in both themes
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10937-6ddd-7b5a-a22f-0bf00eb99afb
---
Build [[0eb99afb]], except the check code:
- the `--hover`, `--selected` and `--hover-danger` tokens;
- migrating all hover and selection backgrounds;
- normal-case labels;
- button hierarchy;
- color values;
- layout of every menu, popup, info card, dialog and tooltip;
- light theme, including chat and composer.

Done when:
- the check with the new families is clean.
