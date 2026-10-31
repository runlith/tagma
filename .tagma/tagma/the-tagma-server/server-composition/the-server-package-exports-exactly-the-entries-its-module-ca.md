---
id: 01a19422-5206-7301-96b2-dc0ce7b72e96
title: The server package exports exactly the entries its module cards declare, so another root imports only declared code
ord: 42
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/package.json
---
A composition root in another repository composes the core through `@tagma/server/...` imports; the import check of this repository cannot judge it, so the package's `exports` map is the boundary it meets. Each server module card's entries map one to one: a `.` entry (the whole module open) is one pattern `./<module>/*` with every `testing/` directory under it set to `null`; a directory entry is a pattern over that directory; a file entry is an explicit key; `testing` entries stay unexported, since they import test-only packages a shipped start may not load. These keys carry only `types` and `bun` and `default: null`: the surface is in-process server code. Explicit keys written for the app and the desktop win over the patterns and stay as they are, a few testing doubles among them. A `for` restriction on an entry binds importers inside this repository only; the map exports such an entry to any root, and nothing versions this surface.

A `set_module` change that opens, moves or closes an entry of a server card changes this map in the same change: an entry the map lacks is unreachable from another root, and a key no card declares opens code nobody declared as surface.