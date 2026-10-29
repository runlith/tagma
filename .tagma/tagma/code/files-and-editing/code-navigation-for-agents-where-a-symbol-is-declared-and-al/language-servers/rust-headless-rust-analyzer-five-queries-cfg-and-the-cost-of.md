---
id: 01a16133-c76c-7ce2-8d04-82b0bde4a8bd
title: "Rust headless: rust-analyzer — five queries, cfg, and the cost of the live model"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Rust rust-analyzer",
      "ref": "https://github.com/rust-lang/rust-analyzer @ bcd39e699382e52b7d8c138a934533cc29be0781 (2026-10-21); https://rust-analyzer.github.io/book; docs web 2026-10-22"
    }
  }
---
The [rust-analyzer bcd39e699382e52b7d8c138a934533cc29be0781](https://github.com/rust-lang/rust-analyzer/tree/bcd39e699382e52b7d8c138a934533cc29be0781) snapshot was read, commit from 21.10.2026; web check of the documentation — 22.10.2026. This is an upstream snapshot, not an identification of the installed rustup component.

| Question | LSP wire | Advertised capability |
|---|---|---|
| Definition | `textDocument/definition` | `definitionProvider:true` |
| References | `textDocument/references` | `referencesProvider:true` |
| Incoming callers | `textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls` | `callHierarchyProvider:true` |
| Outgoing callees | Prepare → `callHierarchy/outgoingCalls` | Same |
| Implementations | `textDocument/implementation` | `implementationProvider:true` |

[Server capabilities](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/lsp/capabilities.rs#L71-L74), [call hierarchy capability](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/lsp/capabilities.rs#L140), [LSP handlers](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/handlers/request.rs#L1895-L1993).

## Observations: semantics and incompleteness

Prepare uses goto-definition, then the LSP handler keeps only Function/Method targets. That matters: an IDE helper for other item kinds does not yet mean an LSP client can start a hierarchy from an arbitrary item.

Incoming accepts only `Definition::Function`, takes `func.usages(sema).all()`, and for each NameRef finds the nearest enclosing `ast::Fn`, passing through macro ancestors. There is no check on this path that the given NameRef sits in a call expression. So a function-as-value reference inside a function may also look like an incoming call; a reference outside an enclosing Fn does not become a regular caller. [incoming_calls](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide/src/call_hierarchy.rs#L44-L97). This is an observation from the code and a conclusion about a possible result, not a launched fixture.

Outgoing genuinely follows `CallableExpr`: resolved Functions, tuple enum/struct constructors, and method calls; other callable kinds are dropped. A method resolves statically through `resolve_method_call`, not through exhaustive runtime dispatch. Descendant bodies include nested syntax nodes, without promoting each closure into a separate hierarchy item. [outgoing_calls](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide/src/call_hierarchy.rs#L99-L157).

Implementations on a trait return impl blocks; on an ADT/type alias/builtin type, known impl blocks of that type; on an associated function/const, same-named items of known impls of that trait. An inherited default trait method creates no new own impl item in each impl. Optionally, derive-generated implementations next to an ADT are filtered. Macro token descent is provided, but its presence does not prove completeness of all proc-macro expansions. [goto_implementation and impls_for_trait_item](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/ide/src/goto_implementation.rs#L24-L137).

References and call hierarchy may exclude tests via `references.excludeTests`; imports are separately filtered by `references.excludeImports`. The scope is bounded by the loaded crate graph, features, target/cfg, and available macro expansions. A result cannot be read as a search of all Cargo configurations and all inactive cfg branches. [Configuration](https://rust-analyzer.github.io/book/configuration), [Cargo/target parameters in the snapshot](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/config.rs#L790-L887).

## Observations: headless process and file changes

rust-analyzer is a native LSP process; no editor is needed, and one process can serve several projects. The semantic core holds source data and the crate graph in memory, computes derived state lazily through Salsa, and receives delta changes. Project-model/toolchain/flycheck invoke Cargo; proc macros run in separate proc-macro server processes loading built dylibs. [Architecture](https://rust-analyzer.github.io/book/contributing/architecture.html).

In the snapshot, `procMacro.processes` defaults to 2; that is not the limit of the full process tree: Cargo, rustc, build scripts, and check-on-save can add child processes. For headless navigation without diagnostics, check-on-save need not be used, but build scripts/proc macros may be needed for a trustworthy model. The concrete process tree was not measured in this study. [Snapshot config](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/config.rs#L386-L398), [check/build-script settings](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/config.rs#L790-L917).

The file watcher defaults to Client, but if the client does not support dynamic `workspace/didChangeWatchedFiles` registration, the Server watcher is picked. So a missing client capability does not mean no observation. A Tagma client with its own watch must genuinely implement registrations and send events; open-buffer edits go via didOpen/didChange. [Watcher choice](https://github.com/rust-lang/rust-analyzer/blob/bcd39e699382e52b7d8c138a934533cc29be0781/crates/rust-analyzer/src/config.rs#L2383-L2391).

## Observations: published resources

[Upstream discussion 23223 from 24.08.2026](https://github.com/rust-lang/rust-analyzer/discussions/23223) cites a sample on rust-analyzer itself: without cache priming and with several open files — 8.3 s **CPU time**, 1627 MB RSS; with priming — 14.8 s and 2225 MB RSS. Hardware, exact SHA, and the full harness are not given in the post; the second interval should not be automatically declared wall-clock. This is evidence for an eager-priming tradeoff, not a portable cold-start/RSS budget and not a Tagma measurement. In the snapshot read, priming is still on by default (`cachePriming_enable:true`); the discussion does not equal an accepted change.

The [configuration documentation](https://rust-analyzer.github.io/book/configuration) describes LRU syntax-tree capacity, worker threads, and memory profiling; capacity 128 is a tree count, not a MB limit. No universal documented cold-start navigation latency/RSS norm was found. No language-server launches or measurements were made locally.

## Conclusion and unknown

Conclusion: rust-analyzer has a headless wire for all five questions, but the incoming hierarchy must not be issued as a list of only actual call sites without verification. Implementation capabilities depend on the loaded cfg/crates and expansion; absence from the model must not be turned into absence from the repository. An LSP capability does not report the share of invisible code.

Unknown: real memory/cold latency and process fanout on Tagma projects, completeness of dynamic dispatch/closure/function-pointer cases, concurrent request costs, fitness of persistent/shared worktree state. Code reading replaces no fixture probes and proves neither latency nor recall.
