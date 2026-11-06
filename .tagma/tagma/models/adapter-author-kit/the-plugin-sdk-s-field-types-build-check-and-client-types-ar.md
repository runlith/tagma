---
id: 01a1ae0e-74de-71b4-9c10-91ef09039173
title: The plugin SDK's field types, build check and client types are generated from the server owners' own code into committed files
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/kit/generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/points.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/operations.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/checks.generated.js
  - kind: file
    ref: packages/tagma/kit/ui.ts
  - kind: file
    ref: packages/tagma/src/plugin/ui.generated.d.ts
---
The SDK sits below the server: the server imports `@runlith/tagma`. Its field types, the build step's verdict and its build's check must still be the owners' own, so the kit generates them instead of importing them. An import would close a module cycle and pull the whole server into every typecheck of the package. `kit/generated.ts` reads the server sources and writes these committed files into `src/plugin/`:
- `points.generated.ts`: the encoded TS types of the envelope, of every point and of checkout-builds' `StepVerdict` (as `BuildVerdict`), plus the point names; each field carries its schema's description as a doc comment, so an author's agent learns from the types what a key means — the meaning of a theme's colour above all;
- `checks.generated.js` with `checks.generated.d.ts`: a Bun bundle of the owners' code itself — the envelope, the plugin id label, every point's face with its schema and checks, and `contributionsRefusal` — answering `manifestRefusal` and `pluginIdRefusal`;
- `ToolFaceState` in `points.generated.ts`, printed from the threads transcript wire's `TranscriptToolState`: the one place the states of a tool card's face are declared. `ToolFace.state` is that type, the window builds the face from the same wire and checks it against `ToolFace` with `satisfies`, and a state added to the wire reaches both with the next generation;
- `operations.generated.ts`: the input and known answer arms of every `external: true` operation;
- `ui.generated.d.ts`: the type facade of `@runlith/tagma/ui`, the door a Svelte view imports.

**Finding the parts.** A point is any `new ContributionPoint(id, FACE)` in the server whose face is a binding imported from its owner's `contract/wire`, so the generator holds no list of points. Operations come from every `contract/wire/module.ts`. A new point, check or external operation reaches the SDK the next time the files are regenerated.

**The `/ui` facade.** `kit/ui.ts` type-checks the window's `ui.ts` (the implementation) together with the app's composition, so the members the composed modules add to `ViewCapabilityMembers` by `declare module` are seen, as a program in which each `.svelte` file is read through svelte2tsx (`svelteProgram`, which the build's type step uses too), and prints one declaration per export of it: the exported types, `useTagma`, and each component as a `Component<props, exports, bindings>` with its props written out. A type that Svelte or the SDK itself declares and a plugin can resolve (`svelte`, `svelte/elements`, `./plugin.js`) stays a named import; any other type the window declares, or takes from a package a plugin cannot resolve, is expanded where it stands, and a recursive one becomes a local alias. A type that does not resolve, or a shape the printer has no form for, fails the generation instead of publishing `any`. The one deliberate narrowing is `PUBLIC_PROPS`: `Frame` shows the props a view may set, which are fewer than the component takes. The facade is a `.d.ts` because it states what the window already declares: a repeated-declaration inspection reads a `.ts` copy as a second declaration of `ViewOpening`. It carries `/// <reference lib="dom" />`, since the window's props name DOM types, and the staleness comparison reads that line.

**Running it.** Run `bun kit/generated.ts` after changing a point, its checks, the envelope, the verdict or an external operation. `kit/generated.itest.ts` fails while any file is stale. It compares the syntax tree and the doc comments with their whitespace folded, so formatting never makes a file stale while a changed description does; the formatter skips the generated files, and `.gitattributes` marks them generated so a comment sweep leaves their descriptions.

**What the build checks.** The bundle carries the owners' filters (`makeFilter`) and cross-point checks as code. So the build's verdict is the server's: the same decode, the same checks, the same reasons. `effect` stays external, and the bundle runs on the SDK's own Effect, the server's version. Two things stay the server's alone: claims, which depend on the other installed plugins, and what a register checks at publication.
