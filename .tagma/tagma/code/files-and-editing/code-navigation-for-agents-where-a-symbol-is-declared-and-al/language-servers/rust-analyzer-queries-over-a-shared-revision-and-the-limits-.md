---
id: 01a16133-ee9e-7013-a7b9-d244e63ec9a3
title: "rust-analyzer: queries over a shared revision and the limits of incremental edits"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "rust-analyzer",
      "ref": "https://github.com/rust-lang/rust-analyzer/tree/bcd39e699382e52b7d8c138a934533cc29be0781"
    }
  }
---
`rust-analyzer` `bcd39e699382e52b7d8c138a934533cc29be0781` was read in `.external/rust-analyzer`; Cargo.toml states Salsa 0.28.5. This is a source reading, with no analyzer launch, tests, or measurements.

**Query model.** `AnalysisHost` owns one `RootDatabase`, and `analysis()` creates an `Analysis` by cloning the base. Inputs are file text, source-root membership, the crate graph, and compilation parameters; derived results are computed by Salsa queries. Syntax, item tree, name resolution, and type inference levels are separated. `file_item_tree_query` takes parse/expand and lowers it into a comparable `ItemTree` structure rather than holding the whole AST as the public result of every semantic query. This is not one prebuilt graph of all references. `FindUsages::search` first picks a scope through crate visibility and dependencies, looks for the text of the name, lazily parses a candidate file, and verifies the match semantically. The text filter is a way to reduce the semantic engine's work, not proof of a link by name.

**Edits.** LSP `handle_did_change_text_document` applies range edits to the open document, bumps the version, and passes the new full bytes into the VFS. A base change causes cancellation and then `change.apply`. The `FileText.text` input holds a full `Arc<str>` of the file. In the `EditionedFileId::parse` read, `ast::SourceFile::parse(text, edition)` is called — a full parse of the file. `syntax` has a separate incremental reparse API, but that API's existence does not mean it is used on the base path shown. The main incrementality here is dependency checking and reuse of equal intermediate results, not a promise to reparse exactly the edited token. An edit to a body potentially affects the parse/item tree of that file and body-level queries; further propagation depends on whether a query's significant intermediate result changed. A global input read by everyone can make the recheck scope wide.

**Memory.** Parse is declared `#[salsa::tracked(lru = 128, returns(clone))]`; other queries have their own compile-time LRU. At the same time, `RootDatabase::update_base_query_lru_capacities` and `update_lru_capacities` on this revision have commented-out bodies: a configurable runtime LRU cannot be treated as working from documentation or a setting alone. For long-lived interned identifiers, `revisions = usize::MAX` occurs. Hence the cached-AST count limit is not an upper bound on the whole process RSS: source texts, interns, dependency metadata, types, and macro/build state remain. No "how many GB per repository" measurement was taken here.

**Sharing.** Cloning the base lets several queries of one state share storage. `AnalysisHost::apply_change` invalidates standing analyses; this is not MVCC in which old readers keep working on an old branch without bounds. The interface read has no operation for a persistent commit index or a fork of the base into an independent worktree with shared unchanged layers. A shared `AnalysisHost` for the agents of one checkout fits this model; a shared mutable host for different worktrees does not follow from it.

**Visible incompleteness.** The LSP references handler returns `Option<Vec<Location>>`, with settings to exclude imports/tests; a missing definition yields `None`. It returns no count of discarded text matches, no list of invisible languages, and no completeness over the whole file tree. Cancellation is distinct from an empty semantic answer. A result's visibility is limited to the loaded crate graph, cfg, and available expansion/type facts; an external text name alone does not turn into a reference.

## Conclusion for Tagma

A useful model is one checkout-state owner, independent language queries, and small intermediate results that stop an insignificant edit from propagating. Borrow the invalidation and ownership boundaries, not Salsa around TypeScript: TS7 already owns its semantic queries. A weak laptop needs measured limits on resident language processes and their state; the word incremental alone and per-query-count LRU guarantee no such thing. A worktree must remain a separate semantic view. Tagma's incompleteness tail is required on top of the adapter's answer, because the LSP references shown carry none.

## Not established

Cold/warm latency, cancellation under frequent edits, RSS, speed on large workspaces, and macro completeness were not measured. No disk cache in other subsystems and no sharing of select immutable artifacts were proven impossible; only that the `AnalysisHost` shown provides no ready-made model of a shared commit index with independent worktree overlays. Rust body-level incrementality does not prove analogous TS7 granularity.

## Sources

- [AnalysisHost, snapshots and cancellation](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide/src/lib.rs#L170-L253).
- [LSP didChange → full document into VFS](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/handlers/notification.rs#L105-L134).
- [FileText and SourceDatabase](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/base-db/src/lib.rs#L217-L268), [full parse and compile-time LRU](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/base-db/src/editioned_file_id.rs#L13-L38).
- [Item tree](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/hir-def/src/item_tree.rs#L124-L208), [text prefilter and semantic verification](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide-db/src/search.rs#L889-L1045).
- [Runtime LRU methods](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide-db/src/lib.rs#L195-L255), [apply_change](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide-db/src/apply_change.rs#L10-L19).
- [LSP references with no coverage envelope](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/handlers/request.rs#L1432-L1478).
