---
id: 01a16195-4d6e-7532-b3ca-94282d4f708a
title: A file is judged in one program from greedy coverage; a program without the target's declaration is another symbol unless it holds its package's .d.ts
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/view.ts
---
A file with candidates is judged in one program. Programs for a question are picked by greedy coverage among those holding both the file and the target's declaration files: checking the same file in several programs multiplies checker type caches — memory and cold time — while one large program usually covers nearly all files. The price: a file may be checked with another tsconfig's options (lib, types); a diverged type yields "unchecked", never a false place.

When no program of the file holds the declaration file, a name in it cannot resolve to the target's source. But the target's package may enter through a build into `.d.ts` (project references, `dist`): then the true reference leads to `.d.ts`, and the engine never links it to the source. So a file whose program holds the declaring package's `.d.ts` gets "unchecked", and only a file whose programs hold nothing of that package gets "another symbol".
