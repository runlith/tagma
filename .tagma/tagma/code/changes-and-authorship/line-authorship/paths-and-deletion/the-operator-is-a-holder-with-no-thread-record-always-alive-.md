---
id: 01a118ac-f593-738f-b768-664918da62b3
title: "The operator is a holder with no thread record: always alive, its lines never swept with deleted threads"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11808-74cb-7b06-9e37-7332919272b1
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/annotation.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/store.ts
---
A line holder is `{kind: 'thread', thread}` or `{kind: 'operator'}`; in `workspace_change.holder` and in fold marks it is the key: the thread uuid or `operator` (`holderKey`/`holderAt` in `workspace/contract/wire/checkout.ts`).

The operator has no thread record, so everything deriving holder state from `thread_record` must skip it:
- Sweeping lines of deleted threads (`RetireStore.orphaned`) excludes `operator` — without this, a server start would revoke every operator line as `thread-deleted`;
- Holdings annotation takes `retired` and `writing` by run only on threads: the operator is never `retired`, and `writing` on it is only an intent in the `writing` state;
- intake looks up no running run for the operator; the line writes with a null `runId`;
- `read_changes {agent}`, `revert_lines`, and `read_rewind` address a thread and never touch the operator; `taking: ['operator']` in landing resolves without a thread record and always requires the operator's word.

The operator's lines leave through the same driver as thread lines: the commit carrying them (the Git tab, `commit_checkout`) stamps them `committed`.
