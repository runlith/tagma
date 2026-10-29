---
id: 01a16132-1577-7944-a3fe-04efcfb93aa0
title: "TypeScript 7: LSP navigation is wider than the API, and an empty answer proves no scope completeness"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "TypeScript 7 LSP, references, implementations and call hierarchy",
      "ref": "https://github.com/microsoft/TypeScript/tree/3e9236361fa97a9e6c685f4833ac457ae2d8c50a — tag v7.1-beta, clean checkout .external/typescript-7.1-beta"
    }
  }
---
Clean TypeScript checkout `v7.1-beta`, commit `3e9236361fa97a9e6c685f4833ac457ae2d8c50a`, was read; paths below from `tsc/internal/`.

**`--lsp` and `--api` offer different surfaces.** `lsp/server.go:1300–1316` registers references, implementations, prepare/incoming/outgoing call hierarchy. References and implementations get the `CrossProjectOrchestrator`; incoming calls get it through a handler, outgoing calls make do with the current Program (`server.go:1440–1511, 2294–2323`). In the full `api/proto.go` method list, of reference navigation there are `getReferencesToSymbolInFile` and `getReferencedSymbolsForNode`; no separate implementation or call-hierarchy methods are declared. `api/session.go:5568–5618` takes `program.GetSourceFiles()` for `getReferencedSymbolsForNode`, calls the LS, and returns node handles. That call does not run the LSP cross-project orchestrator. So sharing a compiler core does not make a standalone API a ready equivalent of LSP navigation.

**How references are found.** This is a query-time search over a Program: the symbol's smallest admissible scope or source files are picked, a text search over the name finds candidates, and the checker confirms the semantic link with aliases, imports, and contextual types (`ls/findallreferences.go:1637–1689, 1853+, 2170–2200, 2535–2670`). The path read has no stored inverted index of all references; `getPossibleSymbolReferencePositions` calls `strings.Index`. `refState` and `inheritsFromCache` are created per request. A warm checker helps with types but does not turn each next references query into reading a ready list of places.

**Implementations.** `ProvideImplementations` uses the same machinery with an implementations flag; a worklist expands linked symbols/references and dedups by nodes/definitions (`findallreferences.go:677–723, 1016–1064`). `addImplementationReferences` recognizes implementations/initializers, shorthand, heritage clauses, some type annotations/return expressions/assertions/satisfies (`2110–2167`). That is a semantic link available to the compiler, not an enumeration of every structurally compatible object in the repository. Matching same-named methods alone proves no implementation.

**Call hierarchy.** Incoming calls derive from found references, then `convertEntryToCallSite` picks call/new/tagged-template/decorator/JSX and also property/element accesses; results group by enclosing declaration, or by source file without one (`ls/callhierarchy.go:541–567, 634–710`). So the LSP incoming-calls name does not promise strictly only syntactic `CallExpression`: Tagma's "call site" contract must separately define whether property reads and the other included forms count. Outgoing calls are collected by walking the declaration body and resolving targets (`callhierarchy.go:718–1004`). No constantly updated call graph was found on these paths.

**Cross-project search.** The orchestrator starts from projects holding the source file, tracks original definitions, then pulls in project-reference trees holding a definition/source/generated location, and merges results (`ls/crossproject.go:46–295`, `lsp/server.go:1468–1511`). `projectcollectionbuilder.go:738–822` loads known configured projects and referenced children, honoring `DisableReferencedProjectLoad`. That is no unconditional scan of every tsconfig in any checkout directory. A separate tsconfig with no project-reference graph to it, which nobody opened/discovered, is not covered merely by the word workspace.

**Incompleteness.** In a normal response, references are `LocationsOrNull`, implementations locations/links/null, incoming calls calls/null; there are no fields for "how many files were unseen" or "which text candidates did not link" (`lsp/lsproto/lsp_generated.go:11197, 11269, 11491, 14256`). Cancellation/errors are handled separately; a successful empty list is by itself no coverage certificate. An unknown ScriptKind may yield a no-project error (`project/session.go:1126–1142`); content-mapper results without fitting mapping fidelity are filtered out of navigation (`findallreferences.go:644–675`, `callhierarchy.go:1107–1114`). Those losses do not unfold into a separate completeness report. The internal `response.complete` of orchestration means one more project search finished, not semantic completeness of all sources.

## Conclusion for Tagma

If the first adapter stays on `tsc --api`, it needs an explicitly chosen compiler scope of projects and its own layer of missing queries; renaming API references into LSP implementations/callers cannot simply be promised. The alternative is using this same compiler core's ready LSP navigation for those queries, leaving AST/type handles to the API. That is an adapter-surface choice, not a reason to introduce language variants into Tagma's core.

Completeness should be reported on two independent axes: snapshot and project freshness/coverage, plus the semantic remainder the checker did not link. Text candidates are useful as separately marked unconfirmed places, but not as additional exact references. A grep-vs-semantic-references difference does not equal the count of missed true references: same-named independent symbols, strings, and comments also leave a remainder. On large repositories such a report can be built over a cheap file/lexical index with an explicit scope and revision, without an expensive repeated full scan per query.

A live query adapter gives current definitions and types with no full indexing phase; the price of a wide references/implementations query can still grow with the count of available Program source files and linked projects. If a disk precise index is introduced, it must be an alternative owner of prepared semantic result, not a cache without invalidation rules over an arbitrary text range. Changing an exported type can change bindings in unchanged files.

## What the reading did not establish

Delays and memory of LSP versus API were not measured; no experiments were run on runlith. Match of the result set with the existing `code-nav` MCP was not checked; its semantics may differ. It is not proven that LSP discovers every standalone tsconfig of a large monorepo or that TypeScript recognizes all Effect structures. Not all `findallreferences.go` branches were studied; the limits listed rest on the entrypoints, scope expansion, and response shapes read, not on a claim of full compiler correctness.
