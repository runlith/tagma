---
id: 01a195e4-0e2f-798d-ae8b-e1a23a3e6fcc
title: A view capability declares itself in its owner's server wire, and the plugins skill lists the capabilities of the modules composed in the root
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/capabilities.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/viewCapabilities.ts
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/capabilities.ts
  - kind: file
    ref: apps/tagma/server/src/views/contract/service/capabilities.ts
---
A member of `useTagma()` is declared once, as a `CapabilityDeclaration` in its owning module's server wire: its id (the member's name), signature and description, plus a reference body where one line is not enough. The owner contributes the declaration to the server's `views/view-capabilities` point through its manifest; composition collects it into `ViewCapabilities`. In the window the same owner builds its capability `{declaration, make}` in a service of its own, from the window services it needs, and joins the `ViewCapabilities` point with `viewCapability`. That point is keyed by the declaration's id and refuses an id the client serves itself. `make` takes only the mount's facts (`projectId`, `plugin`, `view` and the `ended` signal) and builds the member per mount, ending its work with `ended`; `plugin-views` hands a contributor no service. The owner also augments the open `ViewCapabilityMembers` interface with its member's type, so `make` is typed per id, `useTagma()` types the member, and the published `/ui` facade carries it: the kit's program is rooted at the app's composition, which reaches every contributor.

The `plugins` skill is read with `<!-- view-capabilities -->` replaced by one line per declaration the root composed, and every declared reference becomes a reference of that skill. So a root without a module does not mention its member, and no skill text names a member by hand. The client's own members (`projectId`, `tools`, `resource`, `storage`, `thread`, `transcript`, `open`, `openLink`, `theme`) are the `views` module's declarations on the same point (`TAGMA_VIEW`), which the window's client serves without a `make`. The rendering is the native harness's, applied where it discovers the shipped skills, so the text is read from one place.
