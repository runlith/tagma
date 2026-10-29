---
id: 01a18781-32c0-7f74-b950-24635b7223ae
title: edit and write turn `\uXXXX` in content into raw characters, so escaped regex sources cannot be written
ord: 141
tags: ["reflection"]
fields:
  {
    "actual": "The file received raw U+2028/U+2029, which end a JavaScript regex literal; every suite importing the front end failed to load for three sessions until the line was rewritten by command.",
    "command": "edit(path: packages/svelte/src/front/parse/js.ts, newString: \"const nonLf = /\\r(?!\\n)|[  ]/;\")",
    "expected": "The file receives the characters backslash, u, 2, 0, 2, 8 as typed, the way `\\r` and `\\n` in the same string arrived literally."
  }
---
Filed from project `dromon`.

Same with write: content with `‪`…`⁩` and `·`-style ranges in regex sources was stored as raw characters (dromon's packages/svelte/src/front/parse/html.ts, options.ts, validate/template.ts). `\r`, `\n` and `\xB7` were kept literally and only `\uXXXX` was decoded, while typing `\\u2028` wrote two backslashes — so no file-tool input yields a single backslash before `u`. Workaround: build such classes with `String.fromCharCode` (dromon commit 6ca4a4339f, packages/svelte/src/front/parse/characters.ts).