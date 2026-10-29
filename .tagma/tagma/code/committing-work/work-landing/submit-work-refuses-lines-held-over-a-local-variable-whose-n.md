---
id: 01a18081-04c5-787e-aa53-5f6c0f0bc393
title: submit_work refuses lines-held over a local variable whose name matched a field another session added in an imported file
ord: 81
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"selected references require uncommitted declarations: root in apps/tagma/server/src/graph/contract/service/serving.ts:222, held by 01a18045-…\" — root in linking.ts is a local constant (lines 42, 166), and serving.ts imports only RoutedGraphs from that file",
    "command": "submit_work (paths include apps/tagma/server/src/graph/blocks/linking.ts, a one-line edit inside a string literal on line 492)",
    "expected": "The landing goes through: the selected lines reference no uncommitted declaration of another session"
  }
---
Root: `packages/code-facts/src/languages/js/symbols.ts:307` (`use(node)`) puts the text of every identifier that is not a declaration into `uses`, even when `checker.getSymbolAtLocation` resolves it to a local declaration in the same file. `apps/tagma/server/src/change-record/prepared/dependencies.ts:178–202` matches those names against declarations added by another session in import-reachable files, and any text match becomes a dependency.

The refusal's exits are worse than the wait: `whole` carries others' unfinished lines (here — 26 lines importing uncommitted types), `taking` takes a live thread's work.
