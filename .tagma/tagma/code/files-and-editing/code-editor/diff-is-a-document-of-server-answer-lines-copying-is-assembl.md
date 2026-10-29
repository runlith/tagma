---
id: 01a1182b-2b3f-7652-9007-1f2567ce2823
title: Diff is a document of server-answer lines; copying is assembled without removed lines and never handed to the browser
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-editor/src/extensions/diff.ts
---
Diff is an ordinary CodeMirror document built from the line texts as the server sent them (`read_authorship`), with `lineSeparator: '\n'` — otherwise a line with a lone CR would become two — and a companion line field: the line kind, both sides' numbers, the holder mark and `spans` are read by document line number, so document lines and field elements match one to one. A new server answer applies in one transaction: the text changes only between the textually shared head and tail, so expanding a hidden stretch does not reset scroll and selection, while the line field is replaced whole — marks and `spans` of unchanged lines come from the new answer.

**Copying without removed lines.** Copying rebuilds the selected text, skipping `removed` lines, and places it on the clipboard itself, cancelling the browser's action: with an empty result (only removed lines selected) the CodeMirror handler would hand the event to the browser, which would copy the DOM selection together with the removed text. Dragging goes through `clipboardOutputFilter` with the same assembly.

**Why not `@codemirror/merge`.** It needs both full texts and computes the diff itself; it does not accept ready-made lines with holders, hidden stretches and server `spans` ([[0d632257]]).
