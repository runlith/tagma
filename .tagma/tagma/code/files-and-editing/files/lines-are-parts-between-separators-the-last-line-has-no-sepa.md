---
id: 01a11803-2cc0-7853-ab6c-c160e3c6782f
title: "Lines are parts between separators: the last line has no separator, untouched lines keep theirs, new ones take the prevailing EOL"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/files/src/lines.ts
---
Lines are the parts of text between separators, as in CodeMirror: text with k newlines has k + 1 lines, an empty file is one empty line, `a\n` is lines `a` and empty. The separator is `\n` or `\r\n`; a lone CR is line content. So any text can be represented as an edit — typing into an empty file, adding and removing the final newline — and the server's, editor's, and highlight session's line numbers agree.

`LineEdit.lines` holds line bodies without separators. `applyLineEdits` assembles the result thus:
- an untouched line keeps its separator byte-for-byte until it becomes last — mixed files stay mixed;
- the last line has no separator: `a\n` without row 1 is `a`; `a` with an empty row appended at the end is `a\n`;
- a line that stopped being last, and all new lines, get the base's prevailing separator (`\r\n` if those are more, else `\n`);
- the BOM is removed before counting lines and returned to the result's head — otherwise editing the first line would lose it. `splitBodies` yields bodies without BOM — what the editor and highlighting show.

Edits go over base rows, ascending and without overlaps. `range`, `order`, `line` refusals instead of a mangled file; `line` is a body with `\n` or a body ending in `\r` that a separator would follow: `x\r` + `\n` would read as row `x` with the separator `\r\n`. Only a body that becomes the file's last row may end in `\r`. The module is pure and browser-safe: the editor client and the server apply edits with it to the same base.
