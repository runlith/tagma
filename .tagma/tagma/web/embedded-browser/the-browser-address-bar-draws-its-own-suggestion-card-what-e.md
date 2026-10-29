---
id: 01a182f1-2b3a-7943-9144-1ee66a367f81
title: "The browser address bar draws its own suggestion card: what Enter does, running servers, open and recent pages"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a182b5-9dde-787d-b6bb-6d124d3d6df0",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
---
The address field was bound to a native `<datalist>`: Chromium drew the suggestions as a system popup over the whole window, in bold, with raw percent-encoded addresses and no titles, icons or keyboard grammar of Tagma. Focus fell to the global 2 px offset ring, and the profile choice was a native `<select>` in the toolbar row.

Build variant A of the operator-approved mockup: a quiet field at rest showing the host bright and the path muted (no `https://`, no `www.`, percent-decoded, fading end); on focus the field and its suggestions become one card over the toolbar row. Row zero is what Enter does (go or search), host-only inline completion, ↑↓ preview the row's address in the field, Esc steps back (typed text, then the page address, then out). Sections: the project's terminals serving a local port (Running here), open pages (Enter switches), the project's recently closed pages (Recent). Loading draws the waiting tiles in the icon slot of the field and the tab; a profile other than the default and a zoom other than 100% stand in the field only when they differ; an agent driving the page shows its name. A blank page lists the same rows in its body and offers the profile there; back, forward, reload and pick are absent while there is no page.