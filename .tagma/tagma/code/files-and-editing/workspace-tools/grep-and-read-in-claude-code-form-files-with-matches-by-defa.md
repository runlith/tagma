---
id: 01a14642-4b55-7a5d-a9a5-1bbea2c1b721
title: "grep and read in Claude Code form: files_with_matches by default, -A/-B/-C context, bare cat -n output, short cursor only when cut"
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1463e-ca0a-79be-8c80-ad9417db44c1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1457a-68dd-7223-b670-35134eaefe53
sources:
  - kind: file
    ref: packages/agent-tools/src/grep.ts
  - kind: file
    ref: packages/agent-tools/src/read.ts
---
Exp3 ([[4eaefe53]]): on one task the Tagma agent's context grew by +50k against Claude Code's +26k, while the same agent through `rg -A`/`sed -n` in shell grew by +29k. The first grep answered with 4660 characters (match lines, page footer, long cursor); Claude Code answered with 42 characters of paths.

Do: `grep` gets `output_mode` content | files_with_matches (default) | count, `-A`/`-B`/`-C`/`context`, `-n`, `-i`, `multiline`, `glob`, `type`; ripgrep-style output (`path:line:text`, context via `-`), a short summary at the end, cursor only when cut and short. `read` gives `N\ttext` lines with no `<path>/<type>/<content>`, footer only when cut. Law by place (`shown`), refusals, and the ripgrep engine stay; rule 68659e3b (limit, derived default/ceiling, total) is kept. Update the doctrine and the tool descriptions.

Done when: contract tests (files_with_matches by default, `-A`, cursor only when cut, read footer only when cut, law delivered when grep/read touches), `bun run typecheck`, Sol xhigh + Opus high review, commit.
