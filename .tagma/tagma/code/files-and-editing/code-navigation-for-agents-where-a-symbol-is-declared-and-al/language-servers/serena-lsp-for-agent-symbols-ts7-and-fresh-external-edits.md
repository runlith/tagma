---
id: 01a16133-ef1b-78ed-a92c-8b29ba795ca4
title: "Serena: LSP for agent symbols, TS7, and fresh external edits"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Serena LSP backend",
      "ref": "https://github.com/oraios/serena/tree/abb0a0f01b94bc8050086f0fb860077d17730324"
    }
  }
---
Serena `abb0a0f01b94bc8050086f0fb860077d17730324` was read in `.external/serena`. The LSP backend was studied, not the JetBrains backend. No servers were installed or launched; latency, RSS, and search quality were not measured.

**Agent bridge.** The MCP `SerenaFastMCPTool` takes its schema and description from a Serena tool and calls `apply_ex`; symbolic tools delegate to `LspApi`. An agent addresses a symbol through a relative path and a `name_path` like `Class/method`, with an index for overloads, instead of counting UTF-16 columns. `SymbolRetriever.find_unique` resolves ambiguity over the document-symbol tree; then a reference/implementation request uses the line/column found. `find_referencing_symbols` requests references and converts them into surrounding symbols/snippets. Those are references in general, not only call sites: `include_imports=False` and `include_self=False` do not turn the remaining reference kinds into calls.

**Query/index model.** Its own layer stores `documentSymbol` trees per file, while the chosen language server computes semantic references and implementations. The global `find_symbol` is not one ready exact workspace-symbol index: `request_full_symbol_tree` walks the directory, takes each matching file's symbol tree, and then matches by name path. A matching LS is picked per file; without one, several LS may be walked. Raw and high-level document symbol caches are dictionaries `relative_path → (content_hash, result)` kept in the project data cache per LS. A non-empty cache hit needs no repeated LS request; an empty answer is deliberately not cached. This is not a persistent graph of semantic references of its own.

**Changes.** Its own insertion/deletion operations send versioned range edits via didChange. `open_file` lives in a ref-counted context and closes the document at zero references. The file buffer invalidates local contents and hash on increased mtime; the symbol cache compares the hash of the contents read. With a document already open, an on-disk update is passed to the LS as a full-text didChange. For edits outside Serena — another agent, editor, git — `ls_sync_file_system_changes` runs before references/implementations. The notifier collects all source files and mtimes, compares with the previous map, sends `workspace/didChangeWatchedFiles`, and additionally opens/closes created files. Changed-file comparison is `mtime > previous`, not hash and not `!=`. The cost of such a fresh request includes walking the source tree and stating files; delivering a notification alone does not prove the LS has already recomputed the semantic graph.

**TS7.** This revision has a `TsgoLanguageServer`, heir of the TypeScript adapter: the dependency provider picks the native `tsc`, launches `--lsp --stdio`, default package version `7.0.2`. On initialize, `TextDocumentSyncKind.Incremental` is checked. `_wait_for_server_ready` only sets an event; `_signal_expect_indexing` is empty. This is a working source-level sample of connecting an agent to TS7 over LSP, but not proof that a cross-file index is ready at the first-answer time, and not a comparison of LSP against the TS7 API.

**Memory and sharing.** A project creates a `LanguageManager` with a separate process per configured LS; semantic memory stays with those processes. The two symbol dictionaries have no byte budget/eviction shown here. A separate HTTP `ProjectServer` caches projects by `project_root`, lazily creates an LS manager, and can serve several clients, but the route runs under a process-wide active-project lock. That is an example of process reuse by root; it does not mean any stdio MCP instance automatically shares one daemon. Different worktrees with different roots are different project instances; a shared immutable semantic layer by git commit is not established in the code studied.

**Visible incompleteness.** When no configured LS can start, the manager stops the startup of the rest and reports an error. An ambiguous name path returns candidates. Renderers explicitly shorten an overlong answer: no context first, then counts by file, then total. But the `LspReferenceCollectionRenderer` renders the list received from the LS with no mandatory list of unsupported files or type-unlinked text matches. An empty semantic list passes as an empty collection, not as proof of a full repository scan. Not caching emptiness helps later requests, but it is not an incompleteness signal for the current answer.

## Conclusion for Tagma

Worth borrowing are the separation of the language client and agent-facing operations, the independent locations/symbols model, and LS reuse per checkout. Native/MCP doors should address one engine owner rather than launching Serena/LS per agent. Instead of a pre-query walk of all files, Tagma can already feed a shared watch stream of changes; the adapter still needs its own revision/readiness criterion rather than assuming a sent notification is already applied. TS7 LSP is a realistic candidate transport for the first adapter, but its choice against the API needs measurement and verification of the operations needed. Semantic references must not be issued as callers without classifying usage. Coverage and the reasons for incompleteness must be Tagma's contract on top of LSP.

## Not established

The benefit and cost of Serena on real tasks, byte-limit caches, completeness of TS7/Svelte/Rust backends, readiness after external edits, and cache sharing across processes/branches are not proven. The `ProjectServer` read shows in-memory sharing by root but was not studied as a full deployment scheme for all MCP modes. The source does not confirm that multi-language support comes with no backend-specific setup and indexing wait.

## Sources

- [MCP tool bridge](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/mcp.py#L85-L159), [symbol tools](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/tools/symbol_tools.py#L73-L194).
- [LspApi queries and filesystem sync](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/repl/api/lsp_api.py#L495-L609), [unique symbol and reference mapping](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/symbol.py#L737-L880).
- [Document symbol caches](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/solidlsp/ls.py#L1961-L2092), [global walk](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/solidlsp/ls.py#L2200-L2286).
- [Notifier of external changes](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/ls_manager.py#L276-L384), [mtime, buffer and full-text didChange](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/solidlsp/ls.py#L125-L225), [range edits](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/solidlsp/ls.py#L1397-L1549).
- [TS7 LSP adapter](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/solidlsp/language_servers/tsgo_language_server.py#L21-L95), [ProjectServer sharing and serialization](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/project_server.py#L132-L191).
- [Symbol/reference output shortening](https://github.com/oraios/serena/blob/abb0a0f01b94bc8050086f0fb860077d17730324/src/serena/repl/api/lsp_api.py#L164-L280).
