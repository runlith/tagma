---
id: 01a16152-c605-7a6c-848d-1fb17bd07b34
title: read_inspections by function name returns the signature of the function written in tagma.config.ts
ord: 154
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16152-e4e7-7e5c-8806-44c20dabcee1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16152-2c20-7b1b-bc34-2148a7366c31
---
Per [[2838f20e]]: `read_inspections {name: "Files.maxLines"}` prints the parameter schema of the built-in `size`, while the function in `packages/tagma/src/rules/rules.ts` takes `maxLines(lines, { by, files, base })`; a config written from the answer refuses `config-invalid`. The answer by function name must describe calling that function — for every wrapper that reshapes the parameters — with the built-in's schema staying the answer by its id. At the same time: the shared program-inspection hint with no `fix` of its own reads "Remove it where tested's message points." — make it a phrase understandable with no knowledge of internal names.
