---
id: 01a16133-7e5c-7dd5-82aa-adf86f5233af
title: "Sourcegraph search navigation: per-file symbols, heuristic references, and lost limitHit"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Sourcegraph public snapshot — search navigation and Rockskip",
      "ref": "https://github.com/sourcegraph/sourcegraph-public-snapshot/tree/c864f15af264f0f456a6d8a83290b5c940715349"
    }
  }
---
`sourcegraph/sourcegraph-public-snapshot`, commit `c864f15af264f0f456a6d8a83290b5c940715349`, was read: the client's search fallback and the Rockskip symbol index. The [search navigation documentation](https://sourcegraph.com/docs/code-navigation/search-based-code-navigation) distinguishes symbol search for definitions from case-sensitive word-boundary text search for references. That is an alternative candidate source, not verification of symbol identity by types.

[enterprise/codeintel/searchBased.ts](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/client/web/src/enterprise/codeintel/searchBased.ts#L13) builds a definition query `^token$ type:symbol count:50` and a word-boundary reference query `type:file count:500`, case-sensitive, with a language filter or extension. `searchWithFallback` first searches the concrete commit, then after a configured delay starts an index-only search; the first to finish wins. The index-only query does not pin the same commit, because the chosen revision may not be indexed yet.

[useCodeIntel.ts](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/client/web/src/enterprise/codeintel/useCodeIntel.ts#L111) uses precise results, starts search definitions when definitions are missing, and mixing search references into exhausted precise references depends on a separate setting. In [executeSearchQuery](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/client/web/src/enterprise/codeintel/useSearchBasedCodeIntel.ts#L356) the response type carries `limitHit`, but only results are returned. On this path the truncation flag is lost before the navigation consumer.

[Rockskip index.go](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/cmd/symbols/internal/rockskip/index.go#L65) walks commits down to an already-indexed ancestor, processes missing commits in order, takes ChangedFiles, drops old symbols and adds new ones for changed paths. New contents are parsed by `parseSymbols`; unchanged files need not be re-parsed as part of this per-file symbol delta. Symbol availability by revision is stored through a hop structure; symbol/path caches are LRU-bounded. These are syntactic symbols, not semantic references.

[Rockskip search.go](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/cmd/symbols/internal/rockskip/search.go#L91) sends an indexing request when the commit is missing. Depending on the setting, it waits for the result or searches an already-indexed ancestor and replaces `args.CommitID`. So history reuse across branches is observed at the level of a shared repo/commit index, not compiler state of several working trees.

## Conclusion for Tagma

Text and syntactic search are useful as an explicit possible-miss layer next to the TS7 result: "the name was found, the type link is not established". They must not be issued in the same result class as compiler-proven references or calls, and the chosen revision must not be hidden. Candidates need separate truncated, unindexed, and unsupported flags plus the reason for incompleteness. A candidate count means something only with a named scope, filter rules, and an exhausted search; a capped result must not be read as a full count.

A per-file syntax index has an advantageous granularity after an edit, but it cannot be carried over to a semantic index: an unchanged file can change meaning after a change to an imported declaration. A threshold and LRU set a resource policy, but the sources do not imply a fitting size for every Tagma machine.

## Not established

The full text-search backend and its RAM were not read or measured. Heuristic completeness, Rockskip efficiency on runlith history, and the current Sourcegraph product-release policy are not proven. No synthetic project was launched; the lost-`limitHit` observation applies to the stated client path of the snapshot.
