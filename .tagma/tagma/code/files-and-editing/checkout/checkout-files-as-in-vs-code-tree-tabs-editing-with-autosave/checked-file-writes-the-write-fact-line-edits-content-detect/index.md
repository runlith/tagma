---
id: 01a117dd-98e5-7df2-86cb-e3f5bcb8266a
title: Checked file writes, the write fact, line edits, content detection, and ripgrep launch — one owner each in the @runlith/files and @runlith/ripgrep kits
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/lineWrites.ts
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/agent-tools/src/search.ts
  - kind: file
    ref: packages/agent-tools/src/WorkspaceChanges.ts
  - kind: file
    ref: packages/ripgrep/src/index.ts
---
Mechanisms needed by both agents and the file manager live one per kit: checked file writes, the write fact, line edits, content detection, and running ripgrep. The operator sees nothing new; agents get the same tool answers.

## What stands now

- **CAS write written twice:** `packages/agent-tools/src/changed.ts` (`stillStanding`, `created`, `overwritten`, `replaced`) and `apps/tagma/server/src/composition/lineWrites.ts` (`replaceBytes`, synchronous, its own inode-and-bytes "stands"). The second was written because the server's lower floors do not load `@runlith/agent-tools` (0d2c66a9). The file manager would need a third.
- **"Binary" defined five times and differently:**
  - `packages/agent-tools/src/read.ts` `isBinaryFile` — extensions, NUL, and non-printable share;
  - `apps/tagma/server/src/workspace/checkouts/weight.ts` `opensBinary` — NUL in 8000 bytes;
  - `change-record/threadFiles/patch.ts` `binary` — NUL in 8000 text characters;
  - `change-record/prepared/tree.ts` `binary` — NUL or any U+FFFD;
  - `change-record/holdings/inputs.ts` — NUL, and U+FFFD in only one of two branches (p. 389).
- **`WorkspaceChange` type** declared in `packages/agent-tools/src/WorkspaceChanges.ts`, but needed by change-record and `checkout-files`.
- **ripgrep** is launched by `agent-tools/src/search.ts` `runSearch`, `--json` output parsed by `grep.ts`, `--files` by `glob.ts`; `@runlith/ripgrep` only supplies the binary path.

## `@runlith/files` (b77b7a93)

- **`lines.ts` — line edits.** `LineEdit = {from, to, lines}`: base lines `[from, to)` are replaced by `lines`. Lines are text parts between separators, as CodeMirror has them: text with k newlines has k + 1 lines, an empty file is one empty line, `a\n` is lines `a` and empty. So any text is expressible as an edit (including trailing-newline gain and loss and typing into an empty file), and server, editor, and highlight-session line numbers agree. `splitLines` returns lines with their own separators; `applyLineEdits(base, edits)` preserves untouched lines, their separators, BOM, and missing trailing newline byte-for-byte, and gives new lines the base's dominant EOL. A pure module, safe for the browser (`browser` in `exports`): [[413c99cc]] and [[1759d27d]] take it, so it lands first.
- **`content.ts` — `contentOf(bytes)`** → `text {text, bom}` | `binary` (NUL in the first 8000 bytes, as git `buffer_is_binary`) | `undecodable` (UTF-8 with `fatal` fails). All five places move to it: the Git panel, Holdings, and the editor call one thing binary. "Not UTF-8" is separate from "binary": git treats such a file as text; the editor opens it read-only. An agent `read` may add its own extension cutoff on top, but does not redefine "binary". Cost: UTF-16 without BOM is binary, as in git diff.
- **`replace.ts` — CAS write**, moved from `changed.ts`: exclusive creation, overwrite through a temp file beside it with recheck and rename, mode, symlink (the target is written). `composition/lineWrites.ts` calls it instead of `replaceBytes`.
- **`change.ts` — write fact:** the `WorkspaceChange` type and `changeOf`. The type goes to the lowest module using it (144dfedc); agent-tools and change-record import it from there.

Card b77b7a93: entries + `src/lines.ts`, `src/replace.ts`, `src/change.ts`; the body gains: "…as well as checked file writes, the write fact, and line edits".

## `@runlith/ripgrep` (90d97bc9)

- Becomes "binary, search launch, and output parsing": `runSearch` moves here (the `--no-config` envelope, ceiling, signal cancel, process finish) plus `--json` and `--files` parsing.
- The answer is a `Match | FileDone | Summary` stream; agent grep collects it whole, file search delivers it in chunks.
- Failures are typed in ripgrep's words (`SearchLapsed`, `SearchFailed`); `ToolFailed` stays the agent-tools issuance word.
- Processes are spawned by a `ChildProcessSpawner` from the Effect context: agent-tools supplies its own, the server the platform one.
- Card 90d97bc9: title "Ripgrep: binary, search launch, and output parsing"; entries `src/index.ts` (path) and `src/run.ts` (launch and stream) — for 5565be05 and `checkout-files`.

## Removed

- from `changed.ts` — `stillStanding`, `created`, `overwritten`, `replaced`, `changeOf` (`inTurn`, `landing`, `recording`, `recordingMove` — the tool-door layer — stay);
- the `WorkspaceChange` type from `WorkspaceChanges.ts`;
- `replaceBytes` in `composition/lineWrites.ts`;
- five local binary definitions;
- `runSearch` and ripgrep output parsing in `search.ts`, `grep.ts`, `glob.ts`.

Import edits in `change-record/record/*` intersect the running work on [[c16f87cd]] only in import lines; coordinate per 3d635aff.

## Acceptance

- `applyLineEdits` + CAS preserve a CRLF, mixed, BOM, and no-trailing-newline file byte-for-byte outside touched lines; mode 755 is preserved; a write through a symlink changes the target.
- `contentOf`: NUL before byte 8000 — `binary`, after — text; invalid UTF-8 — `undecodable`.
- Agent grep, glob, and read answer as before (their tests green); ceiling and cancel kill the ripgrep process.
