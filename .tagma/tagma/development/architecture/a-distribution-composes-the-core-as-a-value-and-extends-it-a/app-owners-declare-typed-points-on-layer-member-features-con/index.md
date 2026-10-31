---
id: 01a19371-d439-78c0-9c60-473fd4b30c0c
title: "App: owners declare typed points on Layer.member, features contribute from their own layer, replaceable ports take a fallback, and another root is one overlay"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
---
Paths under `apps/tagma/app/src/` unless stated.

## What stands

- Registries — surfaces, panes, sections, links, columns, actions — are filled by globs over the core's own `features/` directory: `lib/app/declared{Actions,Columns,Panes,Sections,Surfaces}.ts`, `lib/app/opening/declaredLinks.ts`, `lib/features/threads/native/declared.ts`, `feedRecords.ts`. Code outside the directory cannot contribute.
- Routes are SvelteKit file routes bound to surfaces by `routes.test.ts`; contributed views have one umbrella only for Tagma Apps, `routes/[project]/p/[app]/[view]`.
- The wire is fixed: `operation.ts` imports the core operation catalog, and `lib/wire/liveGroup.ts` keeps a hand list `USED` of feeds.
- `Shell`, `StatusBar`, `TopBar`, `BlockPage` and `BlockActionsMenu` render fixed sets of parts; a settings section renders contributions only where it opts in (only `apps` does); `NewProjectDialog` hard-codes core-specific fields.
- `@runlith/layer` already has the primitive for contributing with a disposer: `Layer.member`, which backs `Overlay.define().present` and `Snapshot.part`; a member joins when built and leaves when its scope closes or its `Layer.when` condition drops.
- A second client root already exists outside the core by swapping `runtime.ts` in the core's own Vite build and importing internals through `$lib`.

## What will stand

1. **`Point` in `@runlith/layer`.** `Point.define<Item>()('id', { tier, key })` declares a key whose instance is an ordered, clash-refusing, reactive list (`items`, `find`) with `register(item) → dispose` for run-time sources; `X.contribute(...items)` is a `Layer.member` any feature layer from any package merges. The list is a `cell` from the graph's reactivity hooks, so points stay framework-neutral. The clash-by-key ledger of `packages/chat-ui/src/Roster.svelte.ts` becomes the point's core in a kit both layer and chat-ui import.
2. **Owners declare their points; features contribute from their own `layer.ts`.** The registries above become points at their owners; the `declared*.ts` globs and `feedRecords.ts` go; `composition.ts` keeps merging feature layers, and another root merges its own beside them. New points are added at their owner when a feature needs one.
3. **One render helper** for component-carrying points: each item under its own error boundary (explanation `d83d0722`), nothing when empty, the capability gate applied.
4. **Tiers of payload on one point.** A point declares which payloads it admits: a compiled component, and — where it makes sense — a Tagma App view reference registered at run time from `views.subscribe`, as `features/tagma-apps/Sections.svelte.ts` does today.
5. **`Layer.fallback(Key, make)`** — a filler that stands only when no other layer provides the key. An owner marks a service replaceable by declaring it a port with a fallback; every other key stays sealed by `DuplicateProviderError`. Semantics under `Layer.when` and deferred chunks to be designed.
6. **Contracts as interface-shaped keys.** A service other modules or another root consume is keyed by a named interface of its shape — `class Pace extends Service<PaceShape>()(…)` whose `make` builds the implementation class — so doubles and replacements are plain objects. Readers keep today's syntax.
7. **One route umbrella** generalised from `p/[app]/[view]`: a contributed surface carries its view, and the one route renders whatever the registry holds — a component or an app view. Core surfaces keep their own route files.
8. **The root is the one overlay.** `surfaceConfig({ runtime, sources })` replaces each root's plugins; `@tagma/app` gains an `exports` map of points, contribution types, the composition entry and the UI kit.
9. **Wire from the descriptor.** A browser-safe `CATALOG_MODULES` value gives the codec table and the live RPC group, replacing `USED`; operation types widen through an augmentable `interface Operations`, as `interface Ladder` does.
10. **Capability ports.** The core declares `Access` and `AccessHint` ports and binds none; an item may name `right?` and `offer?`. A right gates an item when it is used, never whether it is declared: a restored layout keeps a gated tab kind, and a tab of an undeclared kind is swept from the saved layout. A refused operator act shows the hint through the normal refusal path (`toldOf` → `Told`); a refused agent call goes back to the agent.
11. **New project fields** become a `project-creation` point whose client items are `{ id, order, field, right? }`, rendered after the core fields; a `FieldRefusal` lands under its field.

The design must carry unchanged to another reactivity backend under `@runlith/layer`: points, members and fallbacks are written against layer's primitives, never against the framework's internals.

## Acceptance

- A test app root merges an extra feature layer from outside `features/` that contributes a surface, a settings section, a tab kind, a palette action, a block-menu item and a project-creation field; each appears where its owner renders the point, and the core alone renders none of them with no empty gaps.
- An item under a condition appears and leaves with it; an item that throws is contained by its own boundary.
- A replaced port answers the provider's implementation; without one, the fallback.
- Live feeds and operations of an extra catalog entry decode and subscribe without editing `liveGroup.ts` or `operation.ts`.
- A restored layout naming a gated tab kind keeps it; one naming an undeclared kind opens without it.
- No file under `apps/tagma/app/src` globs another module's directory for declarations.
- Typecheck and the affected packages' tests pass.

## Open

- `Layer.fallback` with conditions and chunks.
- Whether eager members join before stored layouts are restored.
- What a build shows for a visit or tab naming a surface it does not have.
