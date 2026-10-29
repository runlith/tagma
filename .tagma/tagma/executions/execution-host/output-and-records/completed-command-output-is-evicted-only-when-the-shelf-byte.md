---
id: 01a16bec-bf6a-75a2-be08-e40a4d94aa4b
title: Completed-command output is evicted only when the shelf bytes exceed a share of the volume's free space; unread output is protected until first read or window end
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16bde-97d7-7058-8005-5aa1c52e2c26
sources:
  - kind: file
    ref: packages/execution-host/src/InheritedRecords.ts
  - kind: file
    ref: packages/execution-host/src/RecordShelf.ts
---
The retention boundary is a share of the records volume's free space: the shelf evicts records only when its own bytes exceed that share, and only by the excess. Records must not cover the volume reserve's deficit: space below the reserve is usually taken by other people's files, and on a nearly full disk every command release would wipe everything read without restoring the reserve — output would vanish seconds after the command ended, before `search_output` or the first `read_output`. A share of free space holds on a disk of any size and fullness: less space means less output kept, at exhaustion almost none.

The excess is covered by read records first, then unread ones with an expired first-read window; within each group oldest first. The first successful byte read lifts protection, including the server's tail read for command-end notification; state inspection and read refusal do not. The window, on the monotonic clock, should outlive the usual command-wait-and-read cycle. Window expiry only admits eviction at the next command release, never starts deletion itself. Read and unread records carry separate release-order indexes: pressure must not re-walk protected history on every new result. Space measurement and physical deletion are serialized by a single owner so neighbouring releases never cover one excess twice.

The shelf takes even protected records only when its bytes also exceed an emergency, wider share of free space — oldest first and only up to covering that excess; at disk exhaustion there is no first-read promise. Deletion shows as `retention: lost` and a `missing` read refusal. Running executions are not on the shelf, and a started read holds its files. Explicit retire and disown do not wait for first read.

A record whose size could not be measured is remeasured at every next shelf decision and then counts in its bytes and in the generation ledger. Unknown size does not count as zero: until measured, such a record's share cannot be compared, and the volume reserve judges it — below the reserve it goes first if unread and past its first-read window. Otherwise the volume reserve only decides eviction of set-aside generations.

Read state and window belong to the current logic's shelf and do not survive its replacement, but records that earlier logics of the same generation set aside on the shelf stay in its share. Without that they would lie until the generation changes: the current one does not touch generation eviction, and the volume reserve judges only set-aside generations. The new logic takes their bytes at start from the generation ledger in one line, without walking the records directory, and evicts them first, ahead of its own read ones: they are the oldest on its shelf, and the end-notification tail read has almost always lifted their protection, which the new logic never knew anyway. Their order is the executions' creation order in the store; each is measured only at its eviction, and a started read holds its files like the files of a shelved record. Executions the holder handed to the new logic are not among them, even ones it has not taken yet: their record opens adoption. One shelf decision evicts no more than a page of such records, and the logic-start pass repeats decisions until the excess is covered: a large history never holds the shelf and the command release in one long pass. A record that could not be read, measured or marked stays a candidate for the next decision. When no such records remain, the ledger remainder that no line explains leaves the share: otherwise ledger drift would squeeze new records' share forever.

A deletion started by one logic is finished by the next. Before a record is marked `unavailable`, the store writes the intent to delete it together with the bytes it takes in the ledger. After the files are deleted the intent is lifted in one transaction with the return of those bytes: finishing twice never subtracts them twice. The new logic at start reads its generation's remaining intents — not a directory walk, a few lines — and finishes them in the first shelf decision. If the earlier logic never marked the record `unavailable` and `lost`, the new one marks it first and subtracts its bytes from its share. Otherwise a record's files whose deletion the logic's departure cut short would lie until the generation changes: the line is no longer `available`, and no listing enumerates it. Past generations keep the previous retention contract.
