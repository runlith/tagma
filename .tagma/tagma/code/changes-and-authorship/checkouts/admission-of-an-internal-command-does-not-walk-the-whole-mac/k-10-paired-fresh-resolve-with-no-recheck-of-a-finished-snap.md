---
id: 01a102c4-e1a0-744e-a895-be00b9310d58
title: "K=10: paired fresh resolve with no recheck of a finished snapshot"
ord: 2
---
The 2026-10-03 recheck compared the original RootRegistry/FileRootStore from `5c6bad4c06^` with the current implementation in one process on one SQLite fixture and ten sibling roots: two warmups, then 20 fresh resolves per side, AB/BA order alternating. For `5c6bad4c06` the medians were 6.189 → 6.346 ms, median paired difference +0.278 ms, before faster in 9/20 pairs: the earlier 3.83 → 11.70 ms did not reproduce, but the fresh path did extra changesSince, checkedAll, and a repeated probe of its own root right after the full scan. After removing that repeated recheck from RootRegistry — while keeping the final path/witness/revision checks inside the snapshot — the same 20 pairs gave medians 4.904 → 2.719 ms, means 5.039 → 3.314 ms, p90 6.228 → 4.547 ms; median paired difference −2.025 ms, after faster in 16/20 pairs. Both comparisons used the current shared dependencies; parallel machine load remained. The temporary control modules and harness were removed from the checkout; this is an isolated measurement, not a live server.
