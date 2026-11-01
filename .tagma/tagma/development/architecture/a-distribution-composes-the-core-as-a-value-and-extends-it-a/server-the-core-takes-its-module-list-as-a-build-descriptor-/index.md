---
id: 01a19371-d3c3-70d3-886f-04320ac072c1
title: "Server: the core takes its module list as a build descriptor, and modules from another root join every manifest collection, point, flow step, port, store and the admission gate"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
---
Paths under `apps/tagma/server/src/` unless stated.

## What stands

- Operations, feeds, settings, prompt sections, agent tools and contribution points are already assembled from module manifests.
- A build is a value (`composition/build.ts`): `Build` carries the channel, the CLI verb modules and their bindings, `parts` — the lazily loaded `ServerParts` (module list, the two-slot `Bindings`, the rested-fold worker) — and the cut's `Composition`. Developer and release are two such values (`composition/{developer,release}/build.ts`); their entries `cli.ts` and `server.ts` call `runCli(build, server)` and `serve(build)`, and the cut bundles the entries its `Composition.entries` names — paths inside this package, and the cut scripts are bound to the core's two builds until item 10. `assemble(parts)` runs the cross-module manifest check and joins the collections the server needs into one `Assembly` that runtime, serving, doors, CLI and tests take as a value; world parts, the cut's journal steps and the db verb's snapshot participants are derived from the parts where they are used.
- Types: server code addresses operations by runtime ids from the assembly's registry; the client keeps its typing from `composition/catalog.ts`, built over the core repository's whole wire catalog (the developer catalog), so the app's operation input and answer types are unchanged; the release app now carries the developer-only declarations too, and `Build` carries no browser-safe catalog of its own (the App part's). `serverParts` brands the parts `Build.parts` must answer and refuses, at type level, a module whose live door or setting controls need what the core's own consumers do not use, whose installation or serving lifetime needs what its tier is not given (a serving layer is given its own module's installation outputs), or that fills `workspace`, `run` or `call`, which have no tier for it. Operation bodies, `afterRecovery` and same-tier sibling needs are not judged.
- Lifetimes of the core's own modules (`CORE_MODULES`) stay hand-wired in `composition/runtime.ts`, `serving.ts` and `callLifetimes.ts`. A module outside `CORE_MODULES` declares its tier by the key it fills: its `lifetimes.installation` is built over the installation context once it stands, its `lifetimes.serving` over the served owners, and what they provide joins the door's context.
- The `@tagma/server/composition/channel` export condition remains only for the desktop host and the app's scripts, which the cut builds; it goes with item 10.
- The machine database has one migration folder; `packages/activity` and `packages/performance` already keep their own store and migration chain.
- The package exports the in-process surface the server module cards declare (explanation [[e7b72e96]]); nothing yet checks the map against the cards.
- The core's own extension-like modules (release-channel, checkout-builds) still stand their long-lived layers through the two `Bindings` slots, which have no core default; folding them into ports with defaults is item 6.
- Project creation is the first flow step. `add_project` takes `contributed?: Record<entryId, unknown>`; a module contributes `CreationStep<A> = { id, value: Schema.Decoder<A>, step(projectId, value) }` to the `graph/project-creation` point (`graph/contract/service/creation.ts`), and the assembly hands them to the `CreationSteps` reference, empty by default. Every entry is decoded with its step's own schema before registration; `ProjectLifecycle.create` runs the decoded steps in its birth hook, after the registration commits, as the first part of `ServedGraphs.birth`, under the project's exclusive mark and before the first opening. The hook runs in one scope, so a step's undo finalizer sees a later failure, and a failing step takes the registration back. An unknown id or a value the schema refuses answers `field-invalid`. Every step refusal reaches every door with the core refusal wire's `field` naming the entry (`GateRefusal.about`). A step's requirement channel is `unknown` and goes unjudged, like operation bodies. A returned project runs no step. `composition/testing/extension.itest.ts` proves the seam through the HTTP door with a module of the test root.
- The capability gate stands. An operation declaration, a feed declaration and a creation step may name `right?: RightKey`. The right's wire shape `{ key, state, access, unblock, until? }` (`platform/contract/wire/right.ts`) and the `right-missing` refusal, whose body carries it in `right` on every door, are core wire. `Access` (`platform/contract/service/access.ts`) is a port with no core filler: a module fills it in its installation lifetime. `admitRight` refuses when the answer is `none`, or `read` for a use that is not a read. `admitOperation`, which every door passes before prepare, judges by the operation's `effect`; feed admission judges a subscription as a read and a live protocol call as a write; `add_project` judges a step's right before registration, naming the entry in `field`. Drivers and background rounds carry no right field; such work calls `admitRight` itself. When any declaration names a right and no `Access` stands once the installation lifetimes are built, the runtime refuses to start with `AssemblyInvalid` naming the port and the asking declarations. The core names no right. `extension.itest.ts` proves it through the HTTP door with a test filler, and `composition/ports.test.ts` proves the start check.
- The cut hard-codes the checkout (`checkoutOf`), brand, signing, channel and `FEED_REPOSITORY = 'runlith/tagma'` (`installation/contract/wire/feed.ts`), which is both the release channel's feed address and the repository whose GitHub Releases `installation/cut/publish.ts` publishes to; its bundlers take no plugin.

## What will stand

1. **Composition as a value.** The core's entries — server, CLI, cut — take one build descriptor: module list, bindings, verbs, channel, cut settings. Developer and release become two descriptors; the five export-condition slots go. The client's typing is kept (see What stands).
2. **Every manifest collection joins generically**, as operations, feeds and settings already do: no collection is listed by module name in composition.
3. **A generic lifetime tier for extension modules.** The core's own lifetimes may stay hand-wired; a module from another root declares which lifetime its long-lived layers stand in.
4. **Points with a typed face and an optional app face.** An owner declares a point; compiled modules contribute through the typed face (`ContributionPoint`, which stands), Tagma Apps through the app face where the owner admits it.
5. **Flow steps.** A core flow a module joins offers a point at its owner and never takes the module's value through its own input schema. The first flow, project creation, stands (What stands).
6. **Replaceable ports with core defaults.** A lower module declares a port and composition fills it (rule `e090f46d`); where the core must work alone, the owner provides a default filler, so no call site checks for absence.
7. **An owner's own store and migration chain** for a module that keeps tables, on the `packages/activity` precedent.
8. **The in-process surface is exported** from module cards' `entries`, so another root imports only declared entries.
9. **Capability gate** stands (What stands).
10. **The cut takes its descriptor:** source roots, channel, brand, signing, client config, the update feed address and the publisher that places a cut's notarized files and its feed; its bundlers accept the descriptor's plugins. Notarization stays in the cut. A descriptor naming no feed builds a release whose channel reads only the `release.feed` setting; the core ships no feed address and no publisher.

Desktop main-process IPC channels are fixed today; extending them is out of this spec unless a part needs it.

## Acceptance

- A test root composes `[...core modules, extra module]` through the same entries the core uses and serves the extra module's operation, feed, setting, point item, flow step and replaced port; the core alone passes its own tests unchanged.
- No core source imports, lists or branches on a module it does not own; composition contains no per-module list besides the descriptor.
- An operation declared with a `right` is refused `right-missing` at every door when the `Access` filler answers `none`, and served when it answers `full`; a runtime with a declared right and no filler refuses to start.
- `add_project` with a contributed entry runs its step, and a step's refusal comes back with `field` naming the entry.
- A server opening a data directory with settings keys, rows or entry kinds of a module it lacks starts and serves its own operations.
- A release cut from a descriptor naming no feed carries no feed address, and its channel reads only `release.feed`; a descriptor's publisher receives the notarized files and the feed record.
- Typecheck and the affected packages' tests pass.

## Open

- The order of extracting woven capabilities after the first, [[e41dca93]]; each is measured on its own.
- A creation step runs only when its id is in `contributed`. Should a step also be decoded when its entry is absent, so a step can apply a default or refuse a missing value? Then a creation that sends nothing (an agent's `add_project`, the folder-pick path) would still pass through it.
- A creation step's requirement channel is `unknown`, so `add_project`'s body type is `unknown` too and its machine-place guard in `pair` passes vacuously. Judging step needs the way `serverParts` judges lifetimes needs the item type to survive `ContributionPoint.of`.
