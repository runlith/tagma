---
id: 01a191f0-92d4-7eaa-886c-4320fb53bf84
title: "Sub-agent rows: Claude and OpenAI ratings on every route, favor beside spend, reviewers picked from rows marked for review"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18ca7-e2ab-79da-9617-32ed758d8506",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cb0-a4af-755c-aefc-f287afc032e7
sources:
  - kind: file
    ref: packages/agent/src/collaboration/team.ts
---
The contract, server and stored-data part of the spec: `team.ts` (`reviews` on rows, `ReviewPolicy` without `pool` and `split`, the delivered lines), shipped ratings in the Anthropic and OpenAI adapters with Codex CLI gaining them, the `agent.models` and `agent.review` descriptions, the team line's review fingerprint, and one migration of stored pools into `reviews: true` edits in settings, thread copies and browser drafts.