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
- `Shell`, `StatusBar`, `TopBar`, `BlockPage` and `BlockActionsMenu` render fixed sets of parts; a settings section renders contributions only where it opts in (only `apps` does); `NewProjectDialog` hard-codes core-specific fields, the graph remote among them.
- New project fields are a point: the window shell declares `CreationFields` (`lib/app/chrome/creation.ts`), items `{ id, order, payload: { component } }`, drawn by `PointView` after the core fields of `NewProjectDialog`. A field receives `{ draft, value, put, refused }`, and `put` writes its value under its id into `add_project`'s `contributed`. The client `Refusal` carries the wire's `field`: a refusal naming a drawn field is handed to that field, any other goes to the dialog's alert. The core contributes no field; `lib/app/chrome/NewProjectDialog.svelte.test.ts` proves the seam with a fixture field.
- Capability ports stand. `lib/wire/access.ts` declares `Access` (`right(key) → Right | undefined`, read reactively) and `AccessHint` (`hint(right) → { note?, act? }`), with no core filler, and `gateOf(Access.find())`. An item of `CreationFields`, `SectionContributions`, `ComposerParts` or `FeedParts` may name `right?` and `offer?` (`Gated`). `PointView`'s `gate` prop picks each item's payload by the answer and the place's use, `gateOf(Access.find(), 'read' | 'write')`, as the server judges. The item gets its own payload when the answer admits the use, its `offer` when the answer is short, and nothing while the answer is unknown or no filler stands. The dialog, the settings page and composer parts gate writes; feed parts and tabs gate reads. Each place passes its gate, and the dialog sends and routes refusals only for fields the gate draws. A tab kind may name `right?`. It stays declared, so a restored layout keeps its tabs, while `PaneMount` draws a `Told` with the hint in place of the view and the "+" menu leaves its offer out. `Panes` takes members only while the app scope starts (`joins: 'start'`, `@runlith/layer/Point`), so the restore sweep of undeclared kinds never drops a kind that would join later. `Door` hands a refusal carrying a `right` to `AccessHint`, whose note and act ride its `Told`; an agent's refused call comes back to the agent as text with a `right:` line. The tests prove it with doubles of the ports: `NewProjectDialog.svelte.test.ts`, `TabLayouts.svelte.test.ts`, `wire/Door.test.ts` and layer's `point.svelte.test.ts`.
- `@runlith/layer` already has the primitive for contributing with a disposer: `Layer.member`, which backs `Overlay.define().present` and `Snapshot.part`; a member joins when built and leaves when its scope closes or its `Layer.when` condition drops.
- A second client root already exists outside the core by swapping `runtime.ts` in the core's own Vite build and importing internals through `$lib`.

## What will stand

1. **`Point` in `@runlith/layer`.** `Point.define<Item>()('id', { tier, key, order? })` declares a key whose instance is an ordered, clash-refusing, reactive list (`items`, `find`) with `register(from, ...items) → dispose` for run-time sources; `X.contribute(from, ...items)` is a `Layer.member` any feature layer from any package merges, and `from` names the contributor a clash reports. The list is a `Roster` of the `@runlith/roster` kit published through the graph's `cell` hook, so points stay framework-neutral; chat-ui's rosters and `RegistryClash` live in that kit too.
2. **Owners declare their points; features contribute from their own `layer.ts`.** The registries above become points at their owners: `Surfaces`, `Columns`, `PaletteActions` (workspace), `Panes` (shared panes), `LinkKinds`, `LinkMenuItems` (opening), `SettingSections`, `SectionContributions` (settings), and for threads `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts`, `FeedParts`, `ProductRecords` and the wire's `WireEntryKinds`. The `declared*.ts` globs and `feedRecords.ts` go; `composition.ts` keeps merging feature layers, and another root merges its own beside them. Each registry reads its point's current items, since a contribution may join after it was built. Pairwise invariants (a route, a former name, the home, a setting key, a facet) are `claims` the point refuses at admission. A reference to something the build lacks (a column, a parent surface, a contribution's section) degrades instead of refusing. Settings render every section's contributions through `PointView` with `only`. New points are added at their owner when a feature needs one.
3. **One render helper** for component-carrying points, `@runlith/layer/svelte/PointView.svelte`: each item under its own error boundary (explanation `d83d0722`), nothing — no `frame` either — when empty; its `gate` prop applies item 10.
4. **Tiers of payload on one point.** An item carries `payload: { component } | { view }` (`Shown<Props, View>` in `@runlith/layer/svelte/payload`); the item type decides which it admits, and `PointView` renders a view payload through the owner's `view` snippet — for the app, a Tagma App view reference registered at run time from `views.subscribe`, as `features/tagma-apps/Sections.svelte.ts` does today. Layer names no Tagma App.
5. **`Layer.fallback(Key, make?)`** — a filler that stands only when no other layer provides the key; without `make` it takes the key's own. A fallback yields to a provider admitted with it or before it — the manifest itself, or the same condition or chunk — and a provider admitted after it stands (under `Layer.when`, from a chunk or an entry) refuses `DuplicateProviderError`, so a port never swaps under readers that already took it. Every key without a fallback, and two fallbacks of one key, stay sealed by `DuplicateProviderError`.
6. **Contracts as interface-shaped keys.** A service other modules or another root consume is keyed by a named interface of its shape — `class Pace extends Service<PaceShape>()(…)` whose `make` builds the implementation class — so doubles and replacements are plain objects. Readers keep today's syntax.
7. **One contributed route** `routes/[project]/p/[...path]`, generalised from `p/[app]/[view]`: a surface that carries its page (`payload: { component }`, taking the whole `{ path }` under `p`) stands under `p/…`, answers its route and every path below it (the longest registered route wins), and `app/SurfacePage.svelte` renders it through layer's `ShownPayload` under its own error boundary. Every caller resolving the current surface passes the route parameters. Core surfaces keep their own route files. The registry routes such surfaces with no umbrella declared; the `app` umbrella only holds the path of an app section that is not registered yet, and app sections carry the same `SectionPath` page as the umbrella, so registration never remounts the view.
8. **The root is the one overlay.** `surfaceConfig({ runtime, sources })` replaces each root's plugins: `runtime` stands in for the core's `runtime.ts`, `sources` adds directories Tailwind scans, and a root adds any other plugin with `mergeConfig`. `@tagma/app` exports `./surfaceConfig`, `./composition` (which carries the core's `Ladder`, `Operations` and `Feeds` augmentations), `./points/<owner>` — each the owner's file of a point and its contribution types, `./points/catalog` the wire catalog — `./wire/operations` and `./wire/feeds` for a root's own augmentations, `./tsconfig.json` with the `$lib` paths, and the UI kit as `./ui/*`. A root fills the window's environment services itself.
9. **Wire from the catalog.** Each module's wire declaration (`WireModule`) is its catalog entry, carrying its lazy `operations` and its `feeds`; each build has a browser-safe catalog (`composition/{developer,release}/catalog.ts`) that `@tagma/server/composition/catalog` selects by package condition, so the release app carries no developer-only declarations. The root contributes its entries to the client `WireCatalog` point, which gives `Door` its lazily loaded codec table and `Live` its RPC group, replacing `USED`; another root adds its entries beside the core's. Operation and feed types widen through augmentable `interface Operations` and `interface Feeds`, which the root fills beside its contribution, as `interface Ladder` is filled.
10. **Capability ports** stand (What stands).
11. **New project fields** are a point and may name `right?` (What stands).

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

- What a build shows for a visit or tab naming a surface it does not have.
