---
id: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
title: A distribution composes the core as a value and extends it at seams the core declares; with nothing put in, the core works whole
ord: 31
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0ea9b-7901-7f14-b806-e487e090f46d
  - kind: relates
    to: 01a0ea9b-7907-784c-8427-7bb9edea5454
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
---
**Draft.** Written from a reading of the server, the app and `@runlith/layer` on 2026-10-31; no prototype yet. Sections still open are marked.

## Why

Tagma's core must be buildable on its own, and a distribution must be able to compose that same core and add to it — new operations, settings, panels, steps in existing flows, deeper behaviour behind a core service — without editing or forking the core. Today the server is already assembled from module manifests and the app from feature layers, but the set of modules is fixed inside the core: the server picks its variant (developer or release) by export conditions on its own self-imports, the app fills its registries by globbing its own `features/` directory, and several capabilities are woven into core flows with no seam to join or replace. A second composition root cannot add anything.

## The shape

- **A distribution is a composition root that builds one value and hands it to the core's entries:** its server module list, its browser-safe wire catalog, its client layers, and a cut descriptor (source roots, channel, brand, signing, update feed). The core's own developer and release builds become two such values.
- **The core declares seams; extensions fill them.** Four kinds:
  - **points** — an owner-declared, typed, ordered list a feature contributes items to (a settings section, a tab kind, a menu item, a creation field);
  - **flow steps** — a point inside a core flow, whose items take part in that flow (project creation runs each contributed step after registration);
  - **replaceable ports** — a service an owner marks replaceable, filled by a core default that another provider overrides; everything not marked stays sealed;
  - **capability gates** — a declaration may name an access key; the server judges it once at admission, and the client reads the same answer only to render.
- **One mechanism, tiers of reach.** Core modules and a distribution's modules reach every typed point, port, lifetime and store; a Tagma App reaches only the points that admit app views, the operations open to apps and its view bridge — and that face is the future public SDK. No second extension mechanism exists beside it.

## Invariants

- The core names no extension: no import of, branch on, or list of what a distribution adds.
- With nothing put in, the core works whole; every seam has a core default or an empty state.
- Every seam is exercised inside the core's own repository — by a core contributor or a contract test — so a core change that breaks it fails in the core, not later in a distribution.
- A build reading data written by another build — entry kinds, setting keys, stored layouts, rows it does not know — reads them as absent and keeps working.
- A service other modules or a distribution consume as a contract has a key typed by a named interface of its shape; its implementation stays the owner's (a class with reactive fields on the client). Doubles and replacements are plain objects of that shape.

## Parts

- Server — child spec.
- App — child spec.

## Open

- Whether module cards of another repository may import this project's modules, so one import check spans the core and a distribution.
- How a capability woven through core flows is first extracted: each one is a port at its owner, measured feature by feature.
- Acceptance criteria for the whole are the children's together, plus a distribution root in a test that adds one module with an operation, a feed, a setting, a point item, a flow step and a replaced port, and a core build without it that passes the same core tests.
