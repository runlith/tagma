---
id: 01a1271e-2479-7971-9b0c-4ec9854c7e1f
title: A screen checkpoint in the terminal language and recovery from it
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/Appearance.ts
  - kind: file
    ref: packages/execution-host/src/InputModes.ts
  - kind: file
    ref: packages/execution-host/src/Interpretation.ts
---
In the line's worktree. `Interpretation` takes the screen checkpoint at parse rest: what `@xterm/addon-serialize` does not write, for both buffers — stack and flags of kitty keyboard (with sequential pushes), margins and the saved cursor of the inactive buffer, mouse, cursor style, charsets, tab stops, title, `Appearance` colors. The addon patch puts the cursor after DECSTBM and DECOM honoring origin mode (`SerializeAddon.ts:533-561` vs `:704-707`); the `@xterm/headless` patch opens reading of rest; both hunks come with traps per `patches/README.md`. The checkpoint is taken at the first rest after half-retention of output arrives, and on request if the parser is at rest; nobody waits for rest. Recovery: the checkpoint on a fresh engine, replay of the record bytes, answers to queries up to the passed frontier dropped. A terminal with no valid checkpoint or with an unavailable interpretation opens with an unavailable interpretation. The checkpoint is a file in the record folder plus its position. Proven by unit tests: after recovery, output with margins and in origin mode goes to the same cells; a kitty stack pop and return to normal give the same as on the source engine; `InputModes` and `Appearance` match; answers before the frontier are not repeated; replaying from an open OSC brings the parser to the same state. The patches' traps are red without the hunks. By the architect's decision, `@xterm/addon-serialize` is not used at all — the checkpoint writer writes the buffer rows itself, and puts margins, DECOM, cursor, saved cursors, tab stops, and the last cell reprint itself, so the addon patch is unneeded.
