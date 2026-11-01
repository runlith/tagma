---
id: 01a14c85-f889-71f2-8933-7d04992e408f
title: Derived content is regenerated over a partial landing's commit tree
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/hunked.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/programmatic.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
    symbol: planPath
---
Program origin and authorship are separate: recorded command writes and command-observed versions can identify program-origin content without assigning it to a session, and file-tool edits retain that origin on untouched bytes. When selected program-origin content or a `linguist-generated` path would land beside excluded working changes, `submit_work` regenerates it in the commit tree using caller `derive` commands or matching `tagma.config.ts` declarations; declarations also work without origin recognition. Only declared output paths enter the commit, outputs equal to HEAD disappear from its diff, and working output bytes and their recorded holders stay unchanged. Without a matching declaration, the refusal names the outputs, excluded paths and holders, and retained source commands as hints; recorded commands are never replayed automatically. A missing, failed or cut derivation refuses publication. Whole command rewrites without file-tool history and `linguist-generated` paths remain indivisible; `linguist-generated=false` permits line splitting but does not erase program origin. Content with neither retained program-origin evidence nor a declaration cannot be identified as derived.