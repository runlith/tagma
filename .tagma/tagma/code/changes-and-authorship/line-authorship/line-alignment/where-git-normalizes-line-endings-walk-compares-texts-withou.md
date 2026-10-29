---
id: 01a11232-a554-7d4a-9698-c153389d6935
title: Where git normalizes line endings, walk compares texts without CR, while line digests stay real until their text arrives
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/ends.ts
---
The verdict on a path comes from `normalizedAt`: the `text`/`text=auto` attribute, the `eol` attribute when `text` is unset, otherwise `core.autocrlf` (`true` or `input`). The verdict is only requested for paths where `\r` stands on at least one side: in the base or in the working bytes, at discharge in the base or in the line texts, at `write` and `edit` in the before or after text. That way a checkout without CRLF pays nothing for `check-attr` and `config` processes.

Past the verdict, the worker boundary (`endsOf`) converts the base, the bytes and the line texts into the form without `\r\n`. A line hash is only recomputed where its content is known and changed; without text the hash stays real and simply does not match. That is conservative: the line goes unproven rather than to someone else's. Turn rollback (`revert`) does not use this: it needs the real bytes.

The command hunk (`workspaceChangeHunk(…, normalized)`) trims head and tail on CR-free lines and cuts windows from the real texts. So an LF rewrite of a CRLF file yields a hunk only on lines changed in content, while replacing line endings alone yields no hunk.

Typed tools (`write`, `edit`, `import_output`, `delete`) request the verdict through the git of their world, `normalizedAt` over the file's directory. If git does not answer, the hunk is computed exactly, over full lines.
