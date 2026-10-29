---
id: 01a1271e-2479-7971-9b0c-4ed0dc089931
title: The holder returns the old logic when the new one does not come up
ord: 11
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
Per the spec, on logic that will not come up the holder holds everything and waits for a fixed bundle. Returning the old logic from `bundle.prior` is possible only while the new one has not touched `executions.sqlite` with a migration and while the holder itself has not changed; otherwise the old logic will not open the store or will not understand the holder.

The decision lacks a fact: how often new logic that passed stage-1 checks falls at load, and whether it manages to write to the store by then. A stand with injected failures and a count over updates on the operator's machine are needed.
