---
id: 01a0de74-595e-7189-9d95-72da18ff9b7c
title: The hunk a change row carries is searched by widening and rescanning, so attributing one rewritten file costs more the larger it is
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de42-282d-71dd-b8fd-dbcd67ce69bd",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/files/src/content.ts
    symbol: windowMatches
  - kind: symbol
    ref: packages/files/src/hunk.ts
    symbol: workspaceChangeHunk
---
`workspaceChangeHunk` widens its window one line at a time and asks `windowMatches` after every step whether each side now stands exactly once; `windowMatches` scans the whole text for every occurrence. On a text whose lines repeat, the widening runs many times and each run rescans, so the cost climbs with the file's size rather than with the change's.

Measured on one machine, a command rewriting every file under a declared directory, with a change port that costs nothing, so the figures are the capture alone:

| files | bytes each | attributed | the same command, undeclared |
| --- | --- | --- | --- |
| 400 | 200 | 327 ms | — |
| 100 | 4 000 | 1 107 ms | 86 ms |
| 400 | 4 000 | 4 082 ms | 188 ms |
| 800 | 4 000 | 8 267 ms | 253 ms |
| 400 | 20 000 | past 60 s | — |

Twenty times the bytes is twelve times the cost per file; five times again does not finish. The fixture's files are lines that repeat exactly, which is the worst case — a real source is milder — but the shape is the defect, not the fixture.

This is what makes the measurement after a command able to outlast a whole-call rule ([[c28e2112]]), so it is the first thing to fix before any of [[66443549]]'s prices is paid. Find the narrowest unique window without rescanning from the start — the occurrences of a line are known once, and a widening only ever removes candidates. What proves it done: the same table with the cost growing with what the change touched, and [[cb4a953a]], [[e55be589]] and [[b361f4a9]] still holding.

**Done in d4391b4927** by searching the widening steps instead of walking them ([[8f973e1f]]). The same fixture, one machine, the hunk search alone, one line changed in a file whose lines repeat:

| file | before | after |
| --- | --- | --- |
| 100 lines × 40 B | 1.28 ms | 0.05 ms |
| 250 × 80 B | 34.4 ms | 0.08 ms |
| 500 × 40 B | 150 ms | 0.14 ms |
| 1 000 × 20 B | 583 ms | 0.36 ms |
| 1 000 × 20 B, lines repeating every 7 | 69.4 ms | 0.23 ms |
| 1 000 × 20 B, every line rewritten | 0.07 ms | 0.09 ms |

End to end through `bash` with `produces`, a command rewriting one line in each file of a declared directory, a change port that costs nothing:

| declared | command alone | whole call | attribution | of which the hunk search |
| --- | --- | --- | --- | --- |
| 400 files, 7.6 MiB | 237 ms | 579 ms | 343 ms | 83 ms |
| 800 files, 15.3 MiB | 336 ms | 940 ms | 604 ms | 162 ms |
| 1 600 files, 30.5 MiB | 543 ms | 1 978 ms | 1 435 ms | 322 ms |

The 400-file row took about 220 s before, all of it in the hunk search. Attribution is now ≈ 45 ms per MiB rewritten on this machine and grows with the bytes, so what is left is the floor: the texts must be read to be attributed.

A lens review then measured that the search still read the whole file once per halving step even when the answer was one step out. **e4102cbc48** doubles before halving and reuses one table across tries; on a file of unique lines whose changed line repeats the first, one machine: 1 000 lines 0.27 → 0.08 ms, 4 000 0.78 → 0.35, 16 000 2.76 → 1.33, 64 000 11.9 → 5.1. Where the answer really is half the file away — every line alike — the two cost the same (16 000 lines: 6.15 ms and 6.06 ms).

Semantics are unchanged: 38 855 random before/after pairs — alphabets of one to seven lines, up to 400 lines, with and without a closing newline — gave the old walk and the new search byte-identical hunks. The committed test states the contract instead of the old code: each side stands once, no narrower step does, and replaying the window over the earlier text gives the later one.