---
id: 01a0f8bd-dea6-7d3a-ae5b-37e71a67c5d5
title: "A rule binding's params reach the linter as that rule's options: oxlint and ESLint build their config per run from the law"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f8ba-3a87-7f33-91f6-b1fa9edf0605",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
---
Operator's order 2026-10-01: a rule is the one home of its settings and exceptions; an external linter only executes. [[d11108eb]] §4.1 and §5 and [[b29472e3]] §1, §4 and §6 are rewritten to it.

Do:
- oxlint and ESLint adapters build a temporary config each run: every governed id on at error, its binding's `params` as the rule's options (`context.options[0]`). The descriptor's `config` is optional and supplies only the environment (plugins, parsers, settings); its rules are not read.
- Ruff, ast-grep, Semgrep have no per-rule options: params refuse with that reason.

Files: `apps/tagma/inspection/src/runners/{oxlint,eslint,files,ruff,ast-grep,semgrep}`, `apps/tagma/inspection/src/core/program.ts` (descriptor), `apps/tagma/server/src/enforcement/programs/{oxlint,eslint,filesRunner}.ts`. The equivalence proof and directive blanking are removed by [[32061a72]], not here.

Acceptance: an itest on real oxlint 1.86 and ESLint 10.11 — a plugin rule bound with params `{allow:[…]}` receives them in `context.options`, the allowed site gives no finding and the rest do; claims of [[e50acc19]], [[55fb3004]], [[5bc7cd8a]] rewritten from the code.