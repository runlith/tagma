---
id: 01a16133-7e23-78c8-bc8a-8a19c815f707
title: "Sourcegraph precise navigation: shared snapshot documents and position translation across commits"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Sourcegraph public snapshot — precise code navigation",
      "ref": "https://github.com/sourcegraph/sourcegraph-public-snapshot/tree/c864f15af264f0f456a6d8a83290b5c940715349"
    }
  }
---
The public `sourcegraph/sourcegraph-public-snapshot`, commit `c864f15af264f0f456a6d8a83290b5c940715349`, was read. This is a concrete snapshot, not proof of the current behavior of the closed offering. The [precise navigation documentation](https://sourcegraph.com/docs/code-navigation/precise-code-navigation) at reading time describes loading language-specific SCIP indexes and falling back to search navigation; the sources below confirm separate computation and serving layers.

The upload path in `internal/codeintel/uploads/internal/background/processor/scip.go` makes streaming passes over SCIP, canonicalizes documents, and passes them to the codegraph writer in a transaction. [canonicalizeDocument](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/internal/codeintel/uploads/internal/background/processor/scip.go#L251) takes the relative path out of the payload and normalizes the order. [codegraph/insert.go](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/internal/codeintel/codegraph/insert.go#L205) compresses the payload, computes a hash, writes the document with `ON CONFLICT DO NOTHING` and a separate `(upload_id, document_path, document_id)` lookup. One canonical document can serve different uploads, including different commits. A separate inverted index links a symbol ID to definition/reference/implementation ranges.

A query does not raise a TypeChecker. [locations_by_position.go](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/internal/codeintel/codenav/internal/lsifstore/locations_by_position.go#L17) reads the payload of the needed upload/path from the DB and extracts occurrences and relationships. The search is bound to a repository/commit/path and completed uploads, not to mutable editor buffers.

[GetClosestCompletedUploadsForBlob](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/c864f15af264f0f456a6d8a83290b5c940715349/internal/codeintel/codenav/service.go#L650) finds nearby available uploads and checks that commits/paths exist; `getVisibleUpload` translates a position/range from the requested commit into the index commit through a GitTreeTranslator. A matcher that cannot be translated is not used. That is reuse of indexed revisions and coordinates; it does not recompute the types of dependent files after an API change.

The write path has a bounded document batch: up to 256 or an accumulated 32 MiB threshold before the next flush. The size check runs before the next payload is added, so this is not a hard memory bound even for this batch; the process also holds documents, symbols, and DB buffers. The main memory split is that the compiler is needed by the producer at indexing time, while the query server reads stored facts.

## Conclusion for Tagma

A portable principle is an immutable semantic snapshot, dedup of canonical documents, and a separate revision→path→document map with a shared query engine on top. Sharing exact identical artifacts across branches saves disk and repeated loading. A successful line translation through a diff must not replace a semantic freshness check: a dependency change can alter the meaning of an unchanged file.

For a live checkout, the TS7 API stays the owner of computation, with an optional stored index as a derived projection. An answer must tell apart the requested revision, the actually serving revision, the uncomputed dependency fanout, and the absence of a fitting index. A shared checkout engine can divide this state across agents; the snapshot itself provides no such local service.

## Not established

Neither Sourcegraph, PostgreSQL, nor indexing was launched. Query-tier RAM, dedup share, and load cost were not measured; 32 MiB is one upstream batch constant, not a common memory budget. Live updates of uncommitted files, automatic sharing of the TS compiler heap across worktrees, and completeness of the latest Sourcegraph version are not proven. Recalculation granularity after an edit belongs to the external indexer, not to SCIP storage.
