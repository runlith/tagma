---
id: 01a174f7-63a5-7698-a3d1-09929972903e
title: The Tagma app
ord: 23
tags: ["module"]
fields:
  {
    "id": "@tagma/app",
    "kind": "product"
  }
sources:
  - kind: dir
    ref: apps/tagma/app
---
The operator works with Tagma through this app — in the desktop window, a browser tab, or from the phone: project graphs, agent threads, checkouts, terminals, browser and settings. It talks to the server only through declared doors, holds state in `@runlith/layer` services, and lays the interface out by features, each with its own settings, panels, links and actions; the window shell, composition and build bring them together. The app holds no truth of its own: it lives on the server.
