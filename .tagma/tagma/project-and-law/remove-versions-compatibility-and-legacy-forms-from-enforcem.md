---
id: 01a0f901-7ce9-7f6f-971e-107f3b71d896
title: Remove versions, compatibility and legacy forms from enforcement, inspection, code-facts, checks and the graph (rule acb620dd)
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f900-5944-7e1c-9423-192797763f3d",
    "status": "done"
  }
---
Goal: one current form everywhere in apps/tagma/server/src/enforcement, apps/tagma/inspection, packages/code-facts, checks/law, checks/lint and apps/tagma/server/src/graph — no `version`/`contract: 2`/`fingerprintVersion`/`schema: 1`/`capabilities.version`/`RunnerManifest.version`/`"version": 1` in checks/runners.json, no enforcement cache `version`, `calibration:v1:`, behaviour `version`; no legacy block-file lifting (`legacyShape`, `enforcementForm`, `liftLegacyTree`) after one rewrite of runlith's graph files through the server; no `legacy` git-hook state; no reading of old law projections as version 1; no legacy CLI beside the contract-2 producer in checks/law.

Acceptance: contract tests on the new forms pass, tsc over the touched packages passes, claims over the changed code are reconciled from the code. Versions of foreign programs (oxlint, ESLint, Semgrep, ast-grep, Ruff, SARIF document version) stay.

Rule: [[acb620dd]].