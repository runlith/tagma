---
id: 01a14c37-8dea-7790-a3dc-7d49874c4f94
title: Fix texts of the "Project and law" area that disagree with the code
ord: 32
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
- `rewrite_graph_files`: the description says the rewritten files are committed by `sync_graph`, but in stealth storage it refuses; one `graph-required` refusal is declared, while execution also refuses `not-served` and `tree-mid-merge` (`graph/operations/projects.ts`).
- The `tagma project add` help names a `--scope` flag no verb declares.
- Inspection module card bbddbda9: "`tagma check` fetches the law without a server", but `tagma check` calls `check_rules` through the server.
- Catalog record b50ae262: the "on first prompt" orientation fires only for private projects (`orientPrompt`); the rest get it at session start; Gemini doesn't receive the law on file touch at all.
