---
id: 01a0e43d-379e-750a-9db7-c983c7ece48d
title: "Independent reviews of §3.13 v1–v3 (Sol): what was rejected and why"
ord: 1
---
Round history of the performance addendum, by GPT-6 Sol xhigh; later rounds (v4–v9) are summarised in [[fd0dc325]].
- v1 → redesign: P1 without the tree permit, chunked O(delta) storage, in-place ranged file patches, the watcher used as a barrier, and deferring the doctor closure all broke accepted guarantees. Full report: scratch `perf-spec-review-v1.md`.
- v2 → revise: stat-cache symlink hole, flight joins not guaranteed, W6 affected-set indexes incomplete, pending-changes recovery order, T0 placed after preflight. Report: scratch `perf-spec-review-v2.md`.
- v3 → revise: mtime-only cache check, produces baseline taken before permission, pure workers awaited under Held; the fold executor protocol undesigned. Report: scratch `perf-spec-review-v3.md`.
Measured evidence behind the addendum (samples, one machine, 27 September): three long edit_block calls spent 35.2/43.3/61.7 s waiting on the tree permit; one Doctor.closure took 1.045 s inside a 1.36 s hold; `ShellRun.finish` p50 ≤512 ms, p95 ≤4,096 ms over 440 completions. History growth was refuted as a cause. No speedup has been measured.