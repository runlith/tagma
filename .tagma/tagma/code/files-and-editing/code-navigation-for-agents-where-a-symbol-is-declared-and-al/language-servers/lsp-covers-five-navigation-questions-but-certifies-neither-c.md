---
id: 01a16131-68ac-7680-aa87-6839bded77fa
title: LSP covers five navigation questions but certifies neither completeness nor the answer snapshot
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Language Server Protocol 3.17",
      "ref": "https://github.com/microsoft/language-server-protocol @ baf2db31b5fb314a8f358f9a839d3c66e9d98734; _specifications/lsp/3.17"
    }
  }
---
## Observation

The LSP 3.17 specification was read in microsoft/language-server-protocol, commit baf2db31b5fb314a8f358f9a839d3c66e9d98734. Five questions have standard requests: `textDocument/definition`, `textDocument/references`, `textDocument/implementation`; for calls, first `textDocument/prepareCallHierarchy`, then `callHierarchy/incomingCalls` or `callHierarchy/outgoingCalls`. `references.context.includeDeclaration` controls whether the declaration is included. Call hierarchy returns the calling/called entity and the `fromRanges` call sites; `CallHierarchyItem.data` is opaque server data the client keeps for the second request. Support is negotiated through capabilities, including dynamic registration, and does not follow from the name LSP alone.

A headless client is legitimate: `textDocument/didOpen` directly means client-side control of contents, not display in an editor, and the ability to serve a request does not depend by protocol on whether the document is open. The client must still perform initialize/initialized, synchronize workspace/configuration and file changes, and serve the server-declared client requests. Closed files use `workspace/didChangeWatchedFiles`; client-controlled contents use balanced didOpen/didChange/didClose and increasing versions. Positions require agreement on position encoding (UTF-16 by default), URI, and translation from a string/symbol name; that is the adapter's duty, not the agent's.

These five questions' responses share no `isIncomplete` flag, no list of uncovered files, and no guarantee that "the whole checkout is indexed". `partialResultToken` is delivery of parts of an answer, not evidence of semantic completeness. An empty array and null do not explain why nothing was found. Navigation positions/responses carry no mandatory whole-workspace version, and the standard gives no handle of an immutable snapshot to which several questions could be bound. Independent requests may run in parallel; ordering must stay correct, but that is not a multi-request transaction. There is no common batch request for a package of semantic operations, nor an API for AST, symbol identity, and checker types.

Evidence: `_specifications/lsp/3.17/language/{definition,references,implementation,callHierarchy}.md`, `textDocument/{didOpen,didChange}.md`, `types/{textDocumentPositionParams,textDocumentIdentifier}.md`, the Request, Notification and Response Ordering section in `specification.md`. Official publication: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/.

## Contract conclusion

LSP works as a reusable transport for many language adapters but is insufficient as the public contract of the navigation core. The core needs technology-independent operations and separate capability declarations per question; an `unsupported` answer is distinct from an empty set found. The adapter returns the analysis scope and the reasons for limits: configuration/projects, excluded or unsupported files, incomplete loading, unavailable dependencies, interrupted work, dynamic resolution, and source-mapping quality. For calls, an explicit link semantics is useful: a proven call site versus a mere reference from a function — servers mix these entities. The required spec count of remaining textual matches of the name is a separate coverage witness that LSP does not provide; such matches must not be called proven missed references.

One adapter session per checkout can serve all agents: Tagma translates its own observation events into the notifications the server needs, without pretending to be an editor and without creating an independent session per agent. An answer's revision must state the actually established consistency: the exact held snapshot for a backend that provides one; otherwise the observed epoch and a caveat about changes during the request. Batch and AST/checker stay capabilities of the concrete backend under the same contract, not mandatory LSP constraints.

## Not established

Neither the protocol nor capabilities prove the quality of a concrete server, completeness of search over dynamic code, or the cost of a large workspace. No universal numeric budgets follow from the specification; cold start/RSS/latencies were not measured here. The contract wording above is a recommendation from the limits read, not a description of implemented Tagma.
