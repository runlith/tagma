---
id: 01a1182b-2b30-7e83-a57c-a8cd870fb6d8
title: The editor document joins line bodies with \n, so CodeMirror and LineEdit lines agree
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-editor/src/lineChanges.ts
---
The CodeMirror document holds the file's line bodies joined with `\n`, with `lineSeparator: '\n'` — no BOM and none of the file's separators (`splitBodies`). So a CodeMirror line and a `LineEdit` line ([[e3c6782f]]) are one and the same: k newlines give k + 1 lines, editor, server and highlight-session line numbers agree, and `pending()`, the `applyLineEdits` laid over base, yields exactly the buffer with base's separators.

- A lone CR stays line content in the document too: any other separator would make CodeMirror split the line on it. For the same reason a clipboard paste normalizes `\r\n` to `\n` (`clipboardInputFilter`), and an edit's `ChangeSet` is built with the same separator.
- Line edits in a `ChangeSet` (`changeSetOf`) read the text as lines, each followed by a newline, including the imaginary one after the last; an edit touching that imaginary newline lifts it off the insertion or eats the newline before it. So typing into an empty file, the arrival and removal of the final newline, and deleting the last line all follow one formula.
- The reverse mapping (`lineSpans`) takes the lines a change touched; when a change ends exactly at a line's start, before and after, that line is untouched. Without this, deleting `a\n` would grab the next line and raise a false conflict with its edit.
- Adjacent edits (one's `to` = the next's `from`) fuse: two insertions at one position would otherwise give a `ChangeSet` whose order depends on CodeMirror.
