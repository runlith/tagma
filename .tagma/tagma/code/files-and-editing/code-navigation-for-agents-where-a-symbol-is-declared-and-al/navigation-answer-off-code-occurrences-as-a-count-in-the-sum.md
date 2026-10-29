---
id: 01a16403-bd18-7411-af0a-085e0d43b65d
title: "Navigation answer: off-code occurrences as a count in the summary, an excerpt instead of the whole line, the symbol's places first"
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16404-90af-71ed-8c03-b6dc5b6c8359",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
A live measurement after restart: at frequent names the answer is almost all noise. `uses release` is 13 721 rows, of which 13 623 are "unverified: no adapter" in JSON, markdown, and other non-code files; 13 real calls are lost, `kinds` does not drop those rows, and rows go in path alphabet. Each row carries its whole file line: a single-line `apps/tagma/app/src/lib/demo/recordings/world.json` (7 MB) made a 50-row page weigh 323 MB (5–7 s through the CLI). A ripgrep pass with its output parsed in the server process takes 0.3–1.6 s of the question's 0.4–1.8 s (41 MB of JSON output on `release`; ripgrep itself is 0.13 s); during the series the server recorded 0.24–0.66 s event-loop stalls. Do per spec ("outside code", row order, excerpt, pass cost independent of line length) and the "frequent name" acceptance: real places on the first page, and the server counts the answer in no longer than a second.

**Result** (one sample: the nav-answer thread's scratch stand — a kit with the real TS 7 engine on runlith, macOS arm64 12 cores, load average 4–17 from neighbouring agents; warm repeats, 50-row page). `release`: 842–872 ms → 377–627 ms, page 323 MB → 11.6 KB, 14 symbol places on the first page instead of 0, 13 573 occurrences in 85 files in `outside`. `stop`: 892–947 → 366–778 ms, 228 MB → 12.3 KB, 23 places on the page. `CheckoutWatch.follow`: 942–979 → 420–519 ms, 323 MB → 11.6 KB, 23 places. Reference: 74 of 74 before and after. A ripgrep pass without load: the whole checkout in 1.0–1.5 s with 135–268 ms loop stalls → a code pass plus outside-code count in 0.13–0.15 s, stalls ≤ 11 ms. A 7 MB code line with two occurrences: pass 34–101 ms, stall 21–41 ms (column recount 119 → 11 ms).
