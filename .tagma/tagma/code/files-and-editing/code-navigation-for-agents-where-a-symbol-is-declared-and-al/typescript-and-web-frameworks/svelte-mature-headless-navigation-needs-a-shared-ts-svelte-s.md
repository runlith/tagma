---
id: 01a16133-9946-7e23-9e2a-e3029f98dd78
title: "Svelte: mature headless navigation needs a shared TS/Svelte semantic graph"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Svelte Language Tools: svelte2tsx, svelte-language-server, typescript-svelte-plugin",
      "ref": "https://github.com/sveltejs/language-tools/tree/c2a9be791be9229401b3f488058f1d12e930f6f7; .external/svelte-language-tools; svelte-language-server 0.18.5, TS ^5.9.2 || ^6.0.2"
    }
  }
---
## Observation — code read

`sveltejs/language-tools` was studied at commit `c2a9be791be9229401b3f488058f1d12e930f6f7` (2026-10-20), reference checkout `/opt/workspaces/runlith/.external/svelte-language-tools`, fetched via `ag-external-refs/scripts/fetch.py`. In this tree, `svelte-language-server` is version 0.18.5 with a TypeScript peer dependency of `^5.9.2 || ^6.0.2`; this is a master reading, not a check of the published npm tarball contents.

`svelte2tsx` produces virtual TS/JS and a source map; it provides no standalone definition/references/call-hierarchy/implementation API. The TypeScript LanguageService performs navigation, while Svelte tooling translates positions and complements semantics. [DocumentSnapshot.ts](https://github.com/sveltejs/language-tools/blob/c2a9be791be9229401b3f488058f1d12e930f6f7/packages/language-server/src/plugins/typescript/DocumentSnapshot.ts#L118-L158) picks a Svelte snapshot or a regular TS/JS snapshot; [service.ts](https://github.com/sveltejs/language-tools/blob/c2a9be791be9229401b3f488058f1d12e930f6f7/packages/language-server/src/plugins/typescript/service.ts#L446) creates a JS `ts.createLanguageService`.

| Capability | Svelte LSP, TS 5.9/6 JS LS | Evidence |
|---|---|---|
| definition from `.svelte` | Implemented; the result may land in `.ts` or another component | `TypeScriptPlugin.getDefinitions`, lines 461–534: `getDefinitionAndBoundSpan`, snapshots, range translation |
| references from `.svelte` | Implemented; separate handling of components, aliases, and `store`/`$store` pairs | `features/FindReferencesProvider.ts`, lines 28–92, 116–216 |
| incoming calls | Implemented; TS calls complemented with component start-tag usages | `features/CallHierarchyProvider.ts`, lines 130–175, 349–415 |
| outgoing calls | Implemented; component module redirected to generated render, helpers filtered | same file, lines 178–242, 418 ff. |
| implementations | Implemented on `getImplementationAtPosition`; unmappable/generated results dropped | `features/ImplementationProvider.ts`, lines 16–74 |

These are public LSP handlers, not only internal functions: [server.ts](https://github.com/sveltejs/language-tools/blob/c2a9be791be9229401b3f488058f1d12e930f6f7/packages/language-server/src/server.ts#L491-L539) wires definition/references/implementation; lines 627–640 wire prepare/incoming/outgoing call hierarchy. The `svelteserver` binary allows a headless client with no VS Code. Upstream `CallHierarchyProvider.test.ts` holds expectations for a component-to-`util.ts` transition and incoming calls from `.ts` and `.svelte`; these tests were read but not run here.

Queries starting in `.ts`/`.js` are a separate path: the [typescript-svelte-plugin README](https://github.com/sveltejs/language-tools/blob/c2a9be791be9229401b3f488058f1d12e930f6f7/packages/typescript-plugin/README.md) limits its TS/JS-file side and directs `.svelte` to the Svelte LS. Its `src/language-service/index.ts` installs decorators for definition, references, implementation, and call hierarchy. [call-hierarchy.ts](https://github.com/sveltejs/language-tools/blob/c2a9be791be9229401b3f488058f1d12e930f6f7/packages/typescript-plugin/src/language-service/call-hierarchy.ts#L15-L123) translates back results from Svelte, complements component calls, and removes helper calls. Per the README, this plugin sees Svelte-file changes after they are saved to disk. TS-origin references matter precisely here: `typescript-plugin/src/language-service/find-references.ts`, lines 33–69, translates Svelte reference locations, including the branch where the definition sits in a regular `.ts` file (lines 38–47). The public Svelte LSP has no such documented TS-origin path: `server.ts:107` creates a Svelte `Document`, the resolver passes it into `service.ts:555–574`, and `updateSnapshotFromDocument` builds a Svelte `DocumentSnapshot.fromDocument` without checking the extension. Code conclusion: `didOpen` of a regular `.ts` followed by `references` cannot be treated as a correctly supported walk; dependent TS snapshots load differently, via file path. This negative conclusion was not verified by a runtime process. A bare TS program with an ambient `*.svelte` declaration does not provide that connectivity either: `DocumentSnapshot.fromNonSvelteFilePath` deliberately removes such a shim so real component snapshots resolve instead.

## Inference — consequence for headless navigation

The TS5/6 path read serves only as a parity reference: the operator excluded the JS LanguageService and tsserver from Tagma's options for execution cost. Missing Svelte snapshots on the TS side explain the TS-origin reference misses under isolated semantic graphs, but they do not justify a second JS LS. The operator's later decision excludes `.svelte` from the first navigation version entirely: files are explicitly reported as out of scope. A possible future extension is a native TS7 with a content mapper; textual Svelte candidates may only be shown explicitly unresolved, never as typed references/callers.

A component hierarchy here holds more than runtime function calls: `<Child />` is modeled as a caller-component → child-component link. A handler passed as `onclick={handler}` is a reference to a function, but the code read does not imply that passing a callback equals a runtime call. The caller contract must keep that distinction.

LSP provides ready source coordinates but not the spec's mandatory incompleteness tail. Negative source-map positions and synthetic helpers are filtered; the answer has no overall report of all dropped mappings. The server registers a resolver with `watch: true` (`server.ts`, lines 212–224). A fallback filesystem watcher engages only without `workspace.didChangeWatchedFiles.dynamicRegistration` (lines 135–143), and a client may feed watched-file notifications. No full audit of internal ts.sys watchers was performed; Tagma's single-watcher requirement can be treated as neither proven impossible nor already satisfied by installing the stock binary.

## Unknown — not established

No headless end-to-end run on runlith, no cold/warm latency, RSS, Effect implementation completeness, Svelte runes/snippets, or coverage of all 713 live `.svelte` files of the projects were measured. The 713 count comes from `rg --files -g '*.svelte' -g '!archive/**' -g '!.external/**' | wc -l`; it is a checkout file count, not the count of files actually seen by a language service. The matrix proves implementations exist upstream, not that misses are absent.
