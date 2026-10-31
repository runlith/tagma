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
- A build is a value (`composition/build.ts`): `Build` carries the channel, the CLI verb modules and their bindings, `parts` — the lazily loaded `ServerParts` (module list, the two-slot `Bindings`, the rested-fold worker) — and the cut's `Composition`. Developer and release are two such values (`composition/{developer,release}/build.ts`); their entries `cli.ts` and `server.ts` call `runCli(build, server)` and `serve(build, parts)`, and the cut bundles the entries its `Composition.entries` names. `assemble(parts)` joins every manifest collection into one `Assembly` that runtime, serving, doors, CLI and tests take as a value.
- Types: server code addresses operations by runtime ids from the assembly's registry; the client keeps its typing from `composition/catalog.ts`, built over the core repository's whole wire catalog (the developer catalog), so the app's operation input and answer types are unchanged. `serverParts` refuses, at type level, a module whose live door, setting controls or extension lifetime needs a service the core does not serve.
- Lifetimes of the core's own modules (`CORE_MODULES`) stay hand-wired in `composition/runtime.ts`, `serving.ts` and `callLifetimes.ts`. A module outside `CORE_MODULES` declares its tier by the key it fills: its `lifetimes.installation` is built over the installation context once it stands, its `lifetimes.serving` over the served owners, and what they provide joins the door's context.
- The `@tagma/server/composition/channel` export condition remains only for the desktop host and the app's scripts, which the cut builds; it goes with item 10.
- The machine database has one migration folder; `packages/activity` and `packages/performance` already keep their own store and migration chain.
- The package exports 256 entries and no `contract/service/*` entry: an in-process consumer outside the package has no declared surface.
- The cut hard-codes the checkout (`checkoutOf`), brand, signing, channel and `FEED_REPOSITORY = 'runlith/tagma'` (`installation/contract/wire/feed.ts`), which is both the release channel's feed address and the repository whose GitHub Releases `installation/cut/publish.ts` publishes to; its bundlers take no plugin.

## What will stand

1. **Composition as a value.** The core's entries — server, CLI, cut — take one build descriptor: module list, bindings, verbs, channel, cut settings. Developer and release become two descriptors; the five export-condition slots go. Types follow the descriptor as generics, without weakening the client's typing (to be proven).
2. **Every manifest collection joins generically**, as operations, feeds and settings already do: no collection is listed by module name in composition.
3. **A generic lifetime tier for extension modules.** The core's own lifetimes may stay hand-wired; a module from another root declares which lifetime its long-lived layers stand in.
4. **Points with a typed face and an optional app face.** An owner declares a point; compiled modules contribute through the typed face, Tagma Apps through the app face where the owner admits it.
5. **Flow steps.** A core flow a module joins offers a point at its owner and never takes the module's value through its own input schema. First flow: `create_project` takes `contributed?: Record<entryId, unknown>`; the `project-creation` point's server items are `{ id, step(projectId, value) }`, run after registration and before the first graph open, each decoding its value with its own schema and refusing with a `FieldRefusal` naming its entry id.
6. **Replaceable ports with core defaults.** A lower module declares a port and composition fills it (rule `e090f46d`); where the core must work alone, the owner provides a default filler, so no call site checks for absence.
7. **An owner's own store and migration chain** for a module that keeps tables, on the `packages/activity` precedent.
8. **The in-process surface is exported** from module cards' `entries`, so another root imports only declared entries.
9. **Capability gate.** `OperationDeclaration` and `FeedDeclaration` gain `right?: RightKey`. Invocation admission (`invocation/admission/callers.ts`), which every door passes, asks an `Access` port and refuses `right-missing` before prepare and execute when access is `none`, or `read` for an operation whose effect is not read. Work that is not a call — drivers, background rounds, flow steps — asks the same port. The right's shape `{ key, state, access, unblock, until? }` and the refusal body are core wire; a declaration naming a right with no filler fails assembly; the core binds no filler and declares no right.
10. **The cut takes its descriptor:** source roots, channel, brand, signing, client config, the update feed address and the publisher that places a cut's notarized files and its feed; its bundlers accept the descriptor's plugins. Notarization stays in the cut. A descriptor naming no feed builds a release whose channel reads only the `release.feed` setting; the core ships no feed address and no publisher.

Desktop main-process IPC channels are fixed today; extending them is out of this spec unless a part needs it.

## Acceptance

- A test root composes `[...core modules, extra module]` through the same entries the core uses and serves the extra module's operation, feed, setting, point item, flow step and replaced port; the core alone passes its own tests unchanged.
- No core source imports, lists or branches on a module it does not own; composition contains no per-module list besides the descriptor.
- An operation declared with a `right` is refused `right-missing` at every door when the `Access` filler answers `none`, and served when it answers `full`; assembly fails for a declared right with no filler.
- `create_project` with a contributed entry runs its step, and a step's refusal comes back as a `FieldRefusal` naming the entry.
- A server opening a data directory with settings keys, rows or entry kinds of a module it lacks starts and serves its own operations.
- A release cut from a descriptor naming no feed carries no feed address, and its channel reads only `release.feed`; a descriptor's publisher receives the notarized files and the feed record.
- Typecheck and the affected packages' tests pass.

## Open

- The order of extracting woven capabilities after the first, [[e41dca93]]; each is measured on its own.
