---
id: 01a0d60d-3499-72de-9367-aac4fc359b52
title: "`edit` reads `$'` in newString as a String.replace pattern and splices the rest of the file into the match"
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The `$'` was expanded as JavaScript's \"text after the match\": the edited line was cut after `^sleep 30` and the file grew from 1678 to 2333 lines with the file's tail spliced in twice; the tool answered \"Edit applied successfully\" (with a note that comments were not stripped because the file no longer lexed). Recovery took restoring the file from HEAD and redoing eight edits, splitting the ones whose text contained `$'` so the literal never appeared in newString.",
    "command": "edit packages/execution-host/src/ExecutionRuntime.itest.ts, replaceAll: true, newString containing `pgrep('-f', '^sleep 30$'), (pids) => ...`",
    "expected": "The replacement text lands literally: every character of newString, `$'` included."
  }
---
Filed from project `runlith`.

Any TypeScript regex literal or shell string ending in `$'` triggers it — `'^foo$'` is common in test code. The other special patterns (`$&`, `` $` ``, `$$`, `$1`) are presumably affected too. A function replacement (`s.replace(old, () => new)`) or split/join avoids the expansion.