---
id: 01a16131-441e-73fa-a12b-42cc33a13e53
title: "TypeScript 7: snapshots reuse AST, but a new Program gets a new checker pool"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "TypeScript 7 project service and API",
      "ref": "https://github.com/microsoft/TypeScript/tree/3e9236361fa97a9e6c685f4833ac457ae2d8c50a — tag v7.1-beta, clean checkout .external/typescript-7.1-beta"
    }
  }
---
Clean checkout `https://github.com/microsoft/TypeScript`, tag `v7.1-beta`, commit `3e9236361fa97a9e6c685f4833ac457ae2d8c50a`, was read, locally `.external/typescript-7.1-beta`. Paths below from `tsc/internal/`.

**Model.** `project.Session` owns the current `Snapshot`, a queue of file changes, and open overlay documents. `SnapshotHost` owns shared parse/bind caches, content-mapped-file cache, extended-config cache, and a reference count on Programs (`project/session.go`, `snapshothost.go:19–32`). This is live compiler state, not a stored link index by commit. One snapshot holds a collection of configured/inferred/synthetic projects; a Program and checker pool belong to a project, not to the whole checkout. An unchanged project may keep its Program and checker pool when a snapshot clones (`project/project.go:Project.Clone`).

**After an edit.** `DidChangeFile` piles text edits with versions into a pending queue; `getSnapshot` picks the changes up before a request and builds a new snapshot when needed (`project/session.go:374–398, 1055–1124`). Watch notifications pass through the same change set. Snapshot updates are serialized; a request takes a reference to a snapshot, so the previous version may outlive until its reader ends. Accepting a new snapshot releases the session's reference to the previous one (`session.go:1383–1414`).

Granularity has several levels. `ProjectCollectionBuilder.markFilesChanged` marks affected projects; one changed source file admits a `dirtyFilePath`, while several changed files, a deletion, a `package.json` change, or a dependency-lookup change require a full Program rebuild (`projectcollectionbuilder.go:1566–1617`). `Project.CreateProgram` first tries a single-file update; `compiler.Program.ReuseProgram` reuses module-resolution structure and unchanged SourceFiles when imports, directives, module status, and other structural conditions survive. Changes to imports/JSX runtime helpers/redirect groups and other listed conditions lead to a full Program build (`project/project.go:516–604`, `compiler/program.go:336–492`). A full build here does not mean re-parsing every unchanged file: the `ParseCache` is keyed by parse options, ScriptKind, and content hash; a miss calls `parser.ParseSourceFile` and `binder.BindSourceFile`, a hit returns the same AST (`project/parsecache.go:16–35, 72–83`). A changed file parses whole; no splice of an old AST by text range was found on this path.

**Semantic price.** Even a successful single-file Program clone calls `initCheckerPool`, creating a new pool for the new Program (`compiler/program.go:452`). It does not carry over the live checker with its semantic cache from the previous version. An unchanged Program keeps its pool; queries of one version reuse created checkers. So the claim "only one file was recomputed after an edit" is wrong for semantic queries: parse/bind are reused per file, while the types a new Program's checker query needs are computed by a fresh checker on demand. One file change may require a new Program for several projects holding the file.

**Memory and parallelism.** `project/checkerpool.go` lazily creates a diagnostics checker, query checkers with request/file affinity, and a separate standing API checker. By default `MaxCheckers=4` means one diagnostics plus up to three query checkers; the standing API checker sits outside that array. Query/diagnostics checkers drop after an idle timeout (30 s by default), the API checker does not. Semaphores keep two users off one checker. Direct API type/symbol queries use the standing checker for stable handle identity; some LS queries use the query pool. An old discarded pool stops idle cleanup, and memory is freed by the collector once owners are gone (`checkerpool.go:84–112, 223–317, 319–354, 403–505`). That is a per-project checker count, not a process RAM limit or a project count limit.

`Snapshot.Deref` on the last reference frees Programs, parse-cache references, and config owners (`snapshot.go:752–805`); `RefCountCache.Deref` drops the entry at zero (`refcountcache.go:122–135`). The session clears cached disk files unneeded by projects in an idle pass as well; the collection drops projects held by no open files/API-open projects/references (`snapshot.go:606–632`, `session.go:659–695`, `projectcollectionbuilder.go:509–576`). So a long-held API snapshot/handle keeps an old Program, checker, and AST; dropping only the current pointer is not enough.

**Worktrees and branches.** The API supports several independent or derived snapshots inside one `SnapshotHost`, and `SessionInit` may take a shared ParseCache. A stock standalone `tsc --api` creates its own SnapshotHost; an LSP API session may use the current language server's host (`api/session.go:625–635`, `api/server.go:89–106`). ParseCache includes FileName in the parse options: identical bytes at different worktree absolute paths alone do not prove a cache hit. The entrypoints read have no shared disk base by git commit and no mechanism for dividing a semantic Program across processes/worktrees.

## Conclusion for Tagma

A useful base unit is one owner of file revisions and live snapshots per checkout for all agents; the adapter passes changes once, reuses a snapshot for one revision's queries, and releases old snapshots/handles on time. Checkout identity does not equal tsconfig identity: keeping separate compiler projects and their settings, lazily loading the needed ones, is safer than merging an arbitrary monorepo into one synthetic Program.

Fewer processes remove duplication across agents but alone prove nothing for a weak machine: total memory depends on the count of loaded projects, their file overlap, query parallelism, and held versions. Tagma planning must account for that live working set and report which area is not yet loaded; a fixed four checkers per active project cannot be treated as a machine-independent budget.

A shared immutable disk index for worktrees is a separate architecture on top of / next to TS7, not a discovered API capability. For reuse across different paths, text hash is not enough: module resolution, compiler options, dependencies, and the adapter version also shape the semantic result.

## What the reading did not establish

RSS, pause times, full-rebuild versus clone cost, affected-project counts on runlith or a weak machine were not measured; the sources set no numeric memory budget for any repository size. Correctness of a complex multi-project query's snapshot consistency under concurrent edits was not verified; separate LSP orchestration steps may re-request the session. Which internal options are configurable from the published JS client is not established. The reading covers the stated beta and does not guarantee future API stability.
