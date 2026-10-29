---
id: 01a151df-e920-73d7-9b09-09d222aacfd9
title: Terminal Claude Code search with the Grep tool brings the law and explanations of shown files
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adapter/claudeFormat.ts
  - kind: file
    ref: packages/agent-tools/src/shellShown.ts
---
Terminal Claude Code search with the Grep tool brings the place law and shown-file explanations. `claudePrinted` returns a Grep result in `content` mode as `{command: '', output}` (`adapter/claudeFormat.ts:51`), and `shellShown` with no recognized search command returns an empty set without reading the output (`packages/agent-tools/src/shellShown.ts:157`). `hooks/dispatch.ts` passes that empty set into `touch_path`, so a terminal Claude Code search brings neither place rules nor explanation pointers. `claudePrinted.test.ts` checks only the intermediate shape, not delivery.

To do: a non-shell tool search output reads as search sites (`found`) — `HarnessPrinted` says directly it is a search, instead of an empty command. Match Grep line shape against Claude Code output with and without line numbers.

Done (`a8b4d7dd6c`): `HarnessPrinted` is a Shell | Search union; Grep returns `filenames` and `tool_input.path` plus its output, `searchShown` reads them as `found` of the needed files. The shape is taken from Claude Code 2.1.303 sources: `{mode, numFiles, filenames[], content?}`; content is `path:N:text`, without `-n` `path:text`, context with `-`, path omitted for one file; count is `path:count`. Proved in-process (`hookContext.itest.ts`): Grep in all shapes reaches `touch_path` as `found` of the needed files, the guide answer leaves for the CLI. No through system test left: guide got a `Cut` from the 500 ms hook-road budget there — that is [[e057eae7]], a second sample recorded there. After its fix (`89722151d2`) the through test exists: `composition/testing/cli/hookFirst.stest.ts`.

Proof: a through hook test next to `external-harnesses/testing/hookContext.itest.ts`: a real-shape PostToolUse Grep brings the place rule whole and an explanation pointer, the next Read the explanation body; PostToolUse Bash with `sed -n` and `rg` brings the same.
