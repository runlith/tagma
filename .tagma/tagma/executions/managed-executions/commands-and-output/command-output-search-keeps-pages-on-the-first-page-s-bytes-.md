---
id: 01a1690b-fe6a-7b22-85b9-3bab00f2b4ab
title: "Command output search keeps pages on the first page's bytes: the cursor carries stream boundaries, the total and the last match's row"
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/search.ts
---
`search_output` copies the stream's retained bytes into a temporary file and hands it to ripgrep as a separate process: regex over megabytes of output does not go on the event loop, while the pattern dialect matches the agent's grep. A temporary file, not stdin: ripgrep with `--max-count` drops the reading, and writing into a closed pipe would fail with EPIPE, indistinguishable from a real failure.

The first page pins `retainedFrom..durableThrough` for every stream and counts the total (`--count`) over all streams. The cursor carries these boundaries and the total, so later pages of a running command read the same bytes and never recount the total. Continuation reads a stream not from the start but from the byte of the last shown match's row and with its number: the first match there is the already shown row, it is skipped along with the after-context rows the previous page delivered. The before-context of the new page's first match, lying above the continuation point, the reader already saw as a previous row's before-context.

`--max-count` does not bound matches inside the after-context: ripgrep delivers them as Match events past the count. So a page read breaks on the first match past it, together with the context after it; otherwise a page would run longer than `limit` and cursorless.

The row offset ripgrep returns must point into the source bytes, otherwise continuation cuts a row mid-way. So ripgrep searches with `--encoding none`: without it, it recodes UTF-16 with BOM itself, and offsets point into the recoded text.

Continuation does not copy the stream's whole remainder: the window from the continuation point doubles (from 256 KiB, trimmed at the last newline) until it holds a page with a full after-context or the stream ends. Copying to the end on every page would make traversing a dense log quadratic in its size.

A page fits the tool-output envelope by the rows' actual bytes, not by the family row sample: the cursor is taken from the last row that fit, otherwise the envelope truncation would eat it. A row longer than 500 characters shows a window around the first match, not its start: a diagnostic at the end of a long row would otherwise read as a match that cannot be seen.

When retention has moved past the continuation point in the meantime, reading refuses `record-lost` instead of answering with different row numbering.
