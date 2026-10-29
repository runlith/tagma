---
id: 01a14656-8989-7e48-9e45-358b3ef25722
title: "Ripgrep paths with a newline are lost: `--files`, `-l`, and `-c` are read line by line"
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14642-4b55-7a5d-a9a5-1bbea2c1b721
sources:
  - kind: file
    ref: packages/ripgrep/src/run.ts
---
`spawned` cuts ripgrep's stdout into lines (`Stream.splitLines`), and `listFiles` (`--files`), `matchingFiles` (`-l`), and `countMatches` (`-c`) are read that way. A file with `\n` in its name becomes two made-up paths; `glob` and `grep` drop them at `stat`, and the real match is lost along with the law delivery. `searchContent` is unaffected: `--json` escapes the path.

To do: frame names via `--null` (NUL after the path) in these three reads — NUL parsing instead of lines — and escape control characters only in the line the agent sees. Proof: a kit itest on real ripgrep with an `a\nb.ts` file, found by all three reads.
