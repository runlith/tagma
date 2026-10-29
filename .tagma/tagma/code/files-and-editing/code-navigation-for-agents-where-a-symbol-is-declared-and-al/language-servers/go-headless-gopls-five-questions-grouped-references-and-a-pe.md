---
id: 01a16133-c72a-78ff-9ebc-50d7f50fe6ec
title: "Go headless: gopls — five questions, grouped references, and a per-package index"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Go gopls / golang/tools",
      "ref": "https://github.com/golang/tools @ b65ac2ee22000e2f9929e539355d84d651833ed1; https://go.dev/gopls; docs web 2026-10-22"
    }
  }
---
## Observations: version and LSP

Read [golang/tools b65ac2ee22000e2f9929e539355d84d651833ed1](https://github.com/golang/tools/tree/b65ac2ee22000e2f9929e539355d84d651833ed1), 22.10.2026. This is the current source snapshot, not a promise about any installed gopls version. The [official features catalog](https://go.dev/gopls/features/) and [navigation documentation](https://go.dev/gopls/features/navigation) were checked over the web.

| Question | LSP wire | Advertised capability |
|---|---|---|
| Definition | `textDocument/definition` | `definitionProvider:true` |
| References | `textDocument/references` | `referencesProvider:true` |
| Incoming callers | `textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls` | `callHierarchyProvider:true` |
| Outgoing callees | Prepare → `callHierarchy/outgoingCalls` | Same |
| Implementations | `textDocument/implementation` | `implementationProvider:true` |

Method names are exactly `callHierarchy/incomingCalls` and `callHierarchy/outgoingCalls`; the `callHierarchyItem/incomingCalls` found in prose documentation is not a wire method name. [InitializeResult](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/internal/server/general.go#L195-L224).

## Observations: result boundaries

Definition resolves Go symbols and additional cases: import path, doc links, go:embed, and go:linkname. References depend on the chosen file's build configuration: a query from a Windows file does not mean searching the Linux branch. References on an interface method include the matching concrete methods and vice versa; builtin references are not supported. Implementations use method sets in both directions, interface↔concrete. For `any` there are no results. Local/unexported types are not guaranteed across packages. The generic matcher admits excess matches, since type parameters are used as wildcards without full unification. These are limits of the [official navigation documentation](https://go.dev/gopls/features/navigation), not a measurement of a particular checkout's coverage.

The snapshot also has implementation by function signatures: on a `func` declaration/signature and the `(` of a dynamic call. This is matching by signature compatibility, not proof of the actual runtime target. [Documentation in the pinned snapshot](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/doc/features/navigation.md#L89-L168).

**Incoming — a material caveat.** `IncomingCalls` calls `references(..., false)`, then groups each reference by enclosing node; this path has no AST check for "an immediate call". So assigning/passing a function can also land in the incoming hierarchy; this follows from the straight function chain, not a completed fixture. Nested function literals belong to the enclosing named function; where there is no named function, func/init/package nodes are used. [IncomingCalls and enclosingNodeCallItem](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/internal/golang/call_hierarchy.go#L60-L178).

**Outgoing — statically known calls.** The AST traversal looks for CallExpr, and `typeutil.Callee` must return `*types.Func` or a builtin with a package. Trivial builtins like len are skipped. Function-value calls with no known static Func do not become a set of potential runtime targets. Interface calls reflect the known method symbol, not an exhaustive dispatch graph. [OutgoingCalls](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/internal/golang/call_hierarchy.go#L181-L274). The official documentation directly warns about the absence of exhaustive dynamic calls.

## Observations: headless process, cache, watch

The normal headless mode is a long-lived `gopls` over JSON-RPC/LSP stdin/stdout. Inside: the client's Session, several Folders/Views for different roots/build options, an immutable Snapshot after changes, DiskFile and unsaved Overlay. Metadata loads through go/packages, which calls `go list`, so one OS language-server process does not mean no child toolchain processes. Cross-package xrefs/methodsets/typerefs persist in the persistent filecache. [Description of the current design](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/doc/design/implementation.md#L46-L99).

A shared daemon is available: server `-listen=<addr>`, per-client thin forwarder `-remote=<addr>` or auto-start `-remote=auto`; POSIX unix sockets are supported. These are several processes with separate LSP sessions, not one shared mutable overlay for all clients. [Official daemon documentation](https://go.dev/gopls/daemon), [current remote entry](https://github.com/golang/tools/blob/b65ac2ee22000e2f9929e539355d84d651833ed1/gopls/internal/cmd/remote.go). For Tagma this is a launch option, not a requirement to use a daemon instead of one own LSP session.

There is a batch `gopls definition/references/implementation/call_hierarchy`, but the [official CLI documentation](https://go.dev/gopls/command-line) calls the interface experimental, inefficient, and an unofficially supported debugging aid. It should not be taken as a stable headless contract. The LSP client owns didOpen/didChange and file notifications; build options and roots belong to the search scope.

## Observations: published resources

[Go team, 08.09.2023, redesign v0.12](https://go.dev/blog/gopls-scalability): across 28 popular repositories, the average startup/memory reduction against the previous design was about 75%. Method: open a random Go file, wait for loading, measure the **second** opening: initial indexing is amortized. So this is not a cold-start measurement with an empty persistent cache, nor a current absolute budget in MB or seconds. The article describes separate compilation and serializable per-package indexes instead of holding the whole typed program.

Current universal absolute cold-start/RSS figures are not established in the primary materials read. There were no local performance experiments in this study.

## Conclusion and unknown

Conclusion: gopls fits as a headless LSP backend for all five questions, and persistent package indexes are a confirmed example of reduced live RAM and repeated startup. For the callers contract in Tagma, its incoming hierarchy needs care: these are grouped references, not a ready guarantee that "every line is a call". Build-scope signals, incomplete dynamic dispatch, and unknown files must be preserved above the wire.

Current RSS/cold latency on Tagma machines/projects, exact platform/build-tag combination coverage by one View, runtime targets of higher-order calls, and full watch integration of the future headless client are not established. The binary and fixture queries were not run; sources and documentation do not prove the absence of misses.
