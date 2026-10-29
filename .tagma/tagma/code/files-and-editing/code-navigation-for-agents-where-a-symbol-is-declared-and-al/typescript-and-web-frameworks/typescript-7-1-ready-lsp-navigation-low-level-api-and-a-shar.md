---
id: 01a16132-0db6-7f3a-805d-d822e973b466
title: "TypeScript 7.1: ready LSP navigation, low-level API, and a shared semantic session"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "TypeScript 7.1 beta",
      "ref": "https://github.com/microsoft/TypeScript @ 3e9236361fa97a9e6c685f4833ac457ae2d8c50a; tsc/internal/lsp/server.go, packages/typescript/src/api"
    }
  }
---
microsoft/TypeScript was read, commit 3e9236361fa97a9e6c685f4833ac457ae2d8c50a, locally `.external/typescript-7.1-beta`. This is that concrete 7.1-beta checkout, not a promise for any build named tsgo.

`tsc --lsp` implements all five questions. In `tsc/internal/lsp/server.go:1284–1316`, definition, references, implementation, prepareCallHierarchy, and both call-hierarchy queries are registered; the initialization response declares the matching provider capabilities (`:1606–1617`, `:1679`). References and implementation go through `registerMultiProjectReferenceRequestHandler`; incoming calls use a cross-project orchestrator (`:2302–2311`), outgoing calls use the file's project language service (`:2314–2323`). The incoming-calls implementation checks call/new/tagged-template/decorator/JSX targets, not just any reference from a function body (`tsc/internal/ls/callhierarchy.go:547`). This is static compiler navigation, not a trace of actual runtime calls.

`tsc --api` is a different JSON-RPC endpoint, not LSP. In `packages/typescript/src/api/options.ts:53–60`, the client launches a separate process with `--api` and `--async` for the async client; stdio and pipe/socket are supported. The API has immutable snapshot handles: create/update/release, programs, projects, open files and change notifications, AST, symbols, types, and checker. `project.languageService.getReferencedSymbolsForNode(node, position)` returns definition/symbol/reference node handles; `getSignatureUsage(signatureDecl)` returns a name and an optional call handle (`api/async/api.ts:1628–1651`). The server-side `GetSignatureUsages` takes declarations with an identifier name, builds on the current program's references, and keeps non-calls with a nil Call (`tsc/internal/ls/findallreferences.go:1215–1225`); the adapter must tell them apart. The read API protocol also has `checker.getReferencesToSymbolInFile`, `getSymbolAtLocation`, `getAliasedSymbol`, `getResolvedSignature`. No ready public definition/implementation/call-hierarchy methods were found in the API protocol: those questions can be computed on top of AST/checker/reference primitives, but that computation belongs to the adapter and itself needs proof of correctness.

The async API groups several requests into `batchRequests`, automatically or via `batchContext`; large batch responses have a continuationToken (`api/async/client.ts:262–338`). That is no argument that an RPC call of each checker member is cheap: node/type data serialization and AST traversal remain work.

A hybrid without a second independent semantic engine is possible in this checkout: LSP `custom/initializeAPISession` creates an API session over the same project session and issues a private pipe (`lsp/server.go:2334+`); JS `API.fromLSPConnection` connects to it (`api/async/api.ts:422–429`). `getCurrentLanguageServerSnapshot(changes?, baseSnapshot?)` holds the current canonical snapshot with atomic acceptance of passed API changes (`:715–758`). This is a non-standard TypeScript extension, not a portable LSP property.

For watch, in `lsp/server.go:1727–1746` the server prefers client-side `workspace/didChangeWatchedFiles` under dynamic registration. If the client does not declare it, on Windows/FSEvents it may enable its own watcher; on other platforms without a fast recursive backend, watch is disabled. So a headless adapter using Tagma observation must genuinely serve dynamic watch registrations, not merely have no editor.

TS7 contains infrastructure for external content-mapper processes and navigation registration for added extensions (`server.go:364–718`, `ClientSpawnOptions.runExternalCode`). The host holds a connection by mapper identity rather than launching a process per file; transform passes full text (`contentmapper/hostimpl.go:220–258, 772–795`). The generic `contentMapperReferences` fixture has TS-origin `main.ts` → mapped script/template references but uses a synthetic ComponentMapper: evidence of the host's general capability, not of a working Svelte frontend. Fixtures/baseline were read, not launched here. Built-in `.svelte` or `.vue` support does not follow: each needs its language's mapper, its matching version, and verified source-map completeness.

Link to the version read: https://github.com/microsoft/TypeScript/tree/3e9236361fa97a9e6c685f4833ac457ae2d8c50a.

## Conclusion

The first TS adapter can keep the native API chosen by the spec: it gets explicit snapshots, batching, and low-level facts for its own navigation/incompleteness signal. LSP is the already-implemented upstream baseline of five ready queries to compare coverage against, and the hybrid shows no need to duplicate the semantic session if both surfaces are wanted. The mere existence of an upstream implementation query does not prove it finds structural implementations of Effect services: that is a separate semantic check on Tagma's contract.

## Not established

No server or benchmark was launched in this entry; cold start, RSS, warm latency, hybrid benefit, and content-mapper cost were not measured. It is not proven that an API snapshot makes a group of ordinary LSP requests transactional: standard LSP requests take no snapshot id. Parity of the three paths — native adapter, LSP, and content-mapper bridge — was not checked on Tagma's benchmark; handler presence does not equal completeness.
