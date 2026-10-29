---
id: 01a12b57-d42b-7870-8912-18fad028ec40
title: Types are checked only with `bun run typecheck` (tsrs inside `runlith-typecheck`), never `tsc` or a checker directly
ord: 9
tags: ["rule"]
---
The package's typecheck script (runlith-typecheck) or the root bun run tagma:typecheck runs. The diagnostic reference is tsgo: when tsrs and tsgo disagree, tsgo is right.
