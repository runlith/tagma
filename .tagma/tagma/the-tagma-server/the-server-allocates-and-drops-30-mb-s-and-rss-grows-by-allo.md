---
id: 01a13662-e32c-7bec-9643-6acc19d1811a
title: "The server allocates and drops ~30 MB/s, and RSS grows by allocator retention with a flat live heap: 3.6 → 4.4 GB, peak 6.7 GB"
ord: 120
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1362d-a0db-7666-88df-6b9d95a079fc
---
The server allocates and drops ~30 MB/s, and RSS grows through allocator retention with a flat live heap: 3.6 → 4.4 GB, peak 6.7 GB.

The server holds 3.6–4.4 GB RSS with a day peak of 6.67 GB, and RSS grows with no live-object growth. Measured 2026-10-13, server pid 64146, install `20261013T135707182Z`:

- **Live heap does not leak.** Two censuses with a full collection ~17 min apart (`7381705c` → `13c64395`): heap 635 → 621 MB, objects 4.22 → 4.19 M, outside buffers 372 → 360 MB. The heap floor rose over the day from 154 MB (quiet 14:30–15:30 UTC) to ~600 MB under agent load, then holds.
- **RSS grows from the allocator.** Over the same 17 min RSS went 3.63 → 4.35 GB, allocator resident memory 1.73 → 2.15 GB. Committed holds at 9.3 GB.
- **Allocation turnover ~30 MB/s.** The allocator returned 858 GB to the system in 3.4 h of life plus 29 GB more in the 17 min between censuses.
- The heap holds 556k functions and 398–434k closure lexical environments.

Who allocates 30 MB/s is not established. A 30 s CPU profile of that process gave ~150 samples of 200–1100 ms, and no producers can be named from it; this is a profiler defect from [[95a079fc|the idle-CPU task]]. Candidates, unmeasured: request-body assembly for models on each step (`LLM.compile`, `ClaudeCodePresentation.results` p50 512 ms), thread-feed frame serialization, git-output text for status reads.

Do: name the turnover producers with an allocation measurement (or a fixed profile) and remove the turnover at them; then check whether the allocator returns memory after load drops.

Proof: turnover (`purgedBytes` per minute) and RSS before and after on the same load; live heap after a full collection does not grow.

**Observation of 2026-10-23 while working on [[22d81ba0|the startup peak]].** An isolated server (`tagma:try`) on a live-base copy, with no clients or agents, instance `92898613`, build before the Holdings-court fix:
- In the first 6.6 minutes the allocator returned 14 GB to the system (`purgedBytes`). Much of the turnover is startup passes, not agent load.
- After the spike at 86–91 s, heap (1.1 GB) and outside (0.9 GB) stood unchanged for five minutes at almost zero CPU. A census with a full collection showed 279 MB heap and 97 MB outside. So part of the "retention" after the spike is garbage the collector does not collect until the process allocates memory.
- `ps` RSS on the same process held much higher than the vitals' `rssBytes` (3.17 vs 1.76 GB at the fixed peak). These are likely allocator-freed but still resident pages — an inference, not a measurement.

**Observation of 2026-10-31, instance `d7e70846`.** The live heap reported after the last collection was 3.84 GB and stayed unchanged for 15 s while RSS rose from 8.92 to 12.50 GB. Then one collection blocked the loop for 1,278 ms (stall `3685da6b`): 769 ms of the loop thread's 1,021 ms CPU was system time, the heap read 4.00 GB after it, and RSS fell to 11.82 GB. The CPU profile charged the whole pause to Bun's `tagBuffers` in an IPC send, which was the allocating frame at the time, not the work; the evidence is in [[0dcb1f38]].
