---
id: 01a16133-ef70-7b6d-9a15-2566d5f698d4
title: "Atlas: a shared daemon and a tree-sitter file graph with heuristic links"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "Tempest Atlas",
      "ref": "https://github.com/tempestai-dev/tempest/tree/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas"
    }
  }
---
## Observation

Read the `packages/atlas` package from Tempest `1c9abef8655a649ece68806172fb8871a919fb89` in `.external/tempest`. This is a source reading; there were no own performance/accuracy experiments. The path studied is extraction → resolution → SQLite and the MCP shared engine.

**Query/index model.** Atlas extracts syntax facts through tree-sitter WASM: symbol nodes, contains/calls/imports edges, and unresolved references. Extraction calls `parser.parse(this.source)` with no old tree, and after the walk `tree.delete()` frees the AST. Then the resolver applies file path, qualified name, language-specific chain/method matching, exact name, and fuzzy matching. For example, fuzzy admits a sole callable candidate by lowercase name with confidence 0.5, or 0.3 for cross-language; function-as-value has a separate, stricter path. There are framework-specific passes and synthesizers. This is a stored heuristic code graph, not a typechecker and not identity proof through types. SQL indexes and the graph allow reading callers/dependencies without running a compiler per query.

**Edit.** `ExtractionOrchestrator.sync()` takes the full list of current source files and all the database records, deletes missing files, and for existing ones compares size and mtime rounded to the millisecond; only after this pair changes does it read and SHA256-hash the contents. Changed files are indexed whole. `storeExtractionResult` writes nothing when the hash matches; otherwise it deletes the file's records and inserts new nodes/edges/refs. Incoming cross-file edges are preserved in advance and rebound to new target IDs by `(kind, name)` within the file. Then `Atlas.sync` resolves the changed files' unresolved refs and runs post-extract and separate conformance/deferred-member passes. This is file-level incrementality, not tree-edit incrementality and not a general dependency-driven semantic recheck. The mtime+size fast path misses an edit that preserved both values. Plainly copying this approach into a type-aware system does not guarantee re-evaluation of an unchanged caller after a change to an exported type.

**Memory.** Long-lived facts lie in SQLite; the connection enables WAL, a 64 MB page cache, and mmap up to 256 MB. These are settings of individual connections, not a promise of total RSS: mmap does not equal immediate resident memory. The resolver uses seven LRU caches with entry limits (default 5000; the content cache has its own limit), and batch resolution reads ref portions of 5000. Still held are full file lists and reconciliation maps, file results, additional deferred/synthesis structures, and entry size is not byte-bounded. The parse worker pool grows lazily with CPU count, default cap 8, override hard cap 16; one worker is recycled after 250 parses. Each worker carries its own WASM heap, so this policy is no suitable default for a weak laptop without measurement. The code also has a 1 MB source-file size threshold: bounded memory is achieved in part by limiting the parse scope, not by guaranteeing support for a file of any size.

**Sharing checkout/worktree.** `MCPEngine` holds the shared Atlas, watcher, and ToolHandler; the daemon creates sessions over the shared engine, and read workers have their own WAL connections. Initialization joins in one promise. The IPC address is computed from the project root, and the index lies in that root's `.atlas`. This is a direct model of "one heavy engine per checkout, several light agent sessions". A separate check compares the git worktree root against the root of the found `.atlas`; if a nested worktree accidentally found the main checkout's index, MCP marks the result with a foreign-branch warning and recommends a local index. No immutable layer shared by commit across worktrees exists on the read path.

**Visible incompleteness.** MCP tools add warnings about pending/indexing files, a disabled watcher, and worktree mismatch; there is explicit answer shortening by budget. The blast-radius section prints `INFERRED` and `AMBIGUOUS` caller counts with an invitation to check the transitions. This is good visibility of freshness and provenance, but no proof of completeness. A missing edge can mean an unrecognized syntax/framework/type pattern. In batch resolution, both successfully resolved and still-unresolvable refs are deleted; aggregates return while the result arrays stay empty. So after such a pass, the unresolved queue size does not equal the repository's count of unknown references, and no obligatory "all unmatched" tail can be built on it. Mandatory reconciliation against current text candidates is not established in answers.

## Conclusion for Tagma

Useful are a shared daemon per checkout, durable compact facts, explicit freshness/worktree/provenance notices, and never storing all ASTs. These ideas fit the TS7-first adapter: TS7 reports the type truth, while a light syntax/name index can search candidates and show what the type-aware layer did not link. Their answers must differ by provenance; a heuristic edge must never be silently equated to a semantic reference. Atlas's whole-tree reconcile before every small edit, a CPU-only worker count, or rebinding old semantic edges by name alone should not be carried over. Tagma already has a shared watch; exact changed paths let the index owner be updated without re-walking the whole repo, with separate reconciliation after missed events. For a repo of any size, streaming processing and controlled resident cost are needed, not an advertised promise of O(1) memory for any graph.

## Not established

Indexing speed, peak memory, query-worker effects, multilingual extraction completeness, and caller-edge stability under deletion/renaming/type change are not measured. It is not checked that all warnings always reach every MCP tool. Kind/name rebinding is observed in code; accuracy on same-name methods in one file was not experimented with. The whole Tempest deployment is not studied: engine/session separation is proven for the Atlas daemon path, not for every way of launching it.

## Sources

- [Full file parse and tree disposal](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/extraction/tree-sitter.ts#L358-L478).
- [File-level sync](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/extraction/index.ts#L1938-L2073), [record replacement and incoming-edge remap](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/extraction/index.ts#L1814-L1913), [resolution of changed files](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/index.ts#L559-L634).
- [Name matching and numeric confidence](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/resolution/name-matcher.ts#L1328-L1434), [batch resolution drops unresolved](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/resolution/index.ts#L931-L1029).
- [SQLite memory settings](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/db/index.ts#L30-L38), [worker sizing](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/extraction/parse-pool.ts#L56-L96).
- [Shared engine](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/mcp/engine.ts#L53-L95), [IPC by root](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/mcp/daemon-paths.ts#L39-L93), [worktree mismatch](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/sync/worktree.ts#L92-L142).
- [Freshness banners](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/mcp/tools.ts#L354-L408), [visible heuristic tiers](https://github.com/tempestai-dev/tempest/blob/1c9abef8655a649ece68806172fb8871a919fb89/packages/atlas/src/mcp/tools.ts#L2596-L2657).
