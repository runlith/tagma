---
id: 01a16133-99d3-7f30-ad3c-2d4afc9bba04
title: "Vue/Volar: TS-server forwarding in v3 and a native content mapper in v4 alpha"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Vue Language Tools and Vue TS7.1 content mapper",
      "ref": "https://github.com/vuejs/language-tools/tree/ce6c1de8a1ea0b8ef5ded8c1015a864a36ae465e; https://github.com/vuejs/language-tools/tree/5cfef8510c65f877c1298128167f803f18f5063b; .external/vue-language-tools, .external/vue-language-tools-v4; PR #6170 draft"
    }
  }
---
## Observation — Vue/Volar as a Svelte analogue

Reference clones from `ag-external-refs/scripts/fetch.py` were read: `vuejs/language-tools` master `ce6c1de8a1ea0b8ef5ded8c1015a864a36ae465e` (2026-10-21) in `.external/vue-language-tools`; branch `feat/vue-content-mapper`, commit `5cfef8510c65f877c1298128167f803f18f5063b` (2026-10-22) in `.external/vue-language-tools-v4`.

In master, `@vue/language-core` builds virtual code for `.vue`; `@vue/typescript-plugin/index.ts` installs a `createLanguageServicePlugin` from `@volar/typescript`. The plugin wraps the TS JS LS and `.vue` resolution in a shared TypeScript project. That is the same class of problem as Svelte snapshots, but with Volar mappings and Vue codegen.

An important headless boundary: the current [Vue language server](https://github.com/vuejs/language-tools/blob/ce6c1de8a1ea0b8ef5ded8c1015a864a36ae465e/packages/language-server/lib/server.ts#L19-L186) is not a standalone semantic TS server. For project routing and Vue semantic queries it sends `tsserver/request` to the client and waits for `tsserver/response`; `_vue:*` requests must be executed by a TS server with the Vue plugin. So launching one `vue-language-server --stdio` alone proves no ready full headless semantic backend. The client needs a tsserver-side plugin and forwarding, or another composition with the Volar LS.

## Observation — TypeScript 7.1 integration already exists as alpha

The open draft [PR #6170, Vue Language Tools v4](https://github.com/vuejs/language-tools/pull/6170) moves `.vue` typecheck into `tsc` with `@vue/content-mapper`; the example uses `contentMappers` in tsconfig and `tsc --runExternalCode`. That is no claim about Vue master or a published npm package readiness. The [official TS7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers) directly calls the Vue mapper not yet published to npm as of 2026-10-20.

The [mapper.ts](https://github.com/vuejs/language-tools/blob/5cfef8510c65f877c1298128167f803f18f5063b/packages/content-mapper/mapper.ts#L52-L144) read holds project state, calls the Vue language plugin, and returns virtual text, extension, mappings, and diagnostic directives. [spanMappings.ts](https://github.com/vuejs/language-tools/blob/5cfef8510c65f877c1298128167f803f18f5063b/packages/content-mapper/spanMappings.ts#L4-L22) carries navigation flags `Definition`, `TypeDefinition`, `Implementation`, `References`, `CallHierarchy`, not diagnostics alone. This is a JS frontend to the native TypeScript host, not a rewrite of the Vue parser in Go.

| Capability | Vue v3 master | Vue v4 mapper branch + TS7.1 |
|---|---|---|
| Virtual `.vue` ↔ TS graph | Through the Volar TypeScript plugin | Through the content mapper |
| definition / references | TS JS LS/Volar path; standalone Vue LSP depends on forwarding | Flags exist plus saved LSP fixtures for script/template shorthand, parent props, and `defineModel` |
| implementation | Shared TS plugin path; concrete results not measured here | Mapping flag exists; e2e result not verified here |
| incoming / outgoing call hierarchy | Vue-specific component-call semantics completeness not established here | CallHierarchy mapping flag exists; component-call parity not established |

In the branch, [tests/lsp.spec.ts](https://github.com/vuejs/language-tools/blob/5cfef8510c65f877c1298128167f803f18f5063b/packages/content-mapper/tests/lsp.spec.ts#L36-L155) genuinely addresses `textDocument/definition` and `textDocument/references`, checking both script/template sides and parent-child prop links. That is stronger evidence than an enum's presence, but the tests were not run in this work. In the same file, a default `v-model` returns an empty definition because `modelValue` is synthetic with no source token. Not every template concept must have a definition address.

## Inference

Volar shows why a shared LSP transport is useful but does not solve embedded languages by itself: virtual code, project integration, and bidirectional feature-aware spans stay the language frontend's duty. TS7.1 content mappers change the architectural option: one native TS semantic graph can now include `.vue` and `.svelte` while keeping a JS frontend. That is more promising for a single checkout engine than two isolated TS/SFC graphs. Alpha/draft status and JS frontend dependencies must stay explicitly stated conditions rather than vanish behind the phrase "supports TS7".

## Unknown

No alpha build, LSP fixtures, headless Vue forwarding, or production monorepo were launched. Latency, RSS, calls/implementation completeness, and compatibility of the alpha with a concrete TS7.1 beta package were not measured. Mapping-flag presence is no proof of correct component call hierarchy.
