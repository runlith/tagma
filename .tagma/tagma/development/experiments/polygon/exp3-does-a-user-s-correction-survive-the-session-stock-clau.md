---
id: 01a1457a-68dd-7223-b670-35134eaefe53
title: "Exp3: does a user's correction survive the session — stock Claude Code vs Tagma on Ghostfolio"
ord: 3
tags: ["experiment"]
fields:
  {
    "status": "planned"
  }
---
**Hypothesis.** A correction said by the user once in chat survives the session in Tagma and stops the agent repeating the mistake in a new task; in stock Claude Code it does not. Refuted if in tasks 6–9 both sides repeat corrected mistakes equally often (or both do not).

**Setup.**
- Ghostfolio `c3596ea292`, shallow. `gf-classic` (project 38, `/opt/workspaces/gf-classic`): Claude Code 2.1.301 plain harness, `CLAUDE_CONFIG_DIR=/opt/workspaces/.claude-classic`, `auto` mode (from the second run of task 1). `gf-tagma` (project 37, `/opt/workspaces/gf-tagma`, history deepened by 1 commit): Tagma agent, trust mode, the operator's global rules and skills off, `AGENTS.md`/`CLAUDE.md` reading on; the operator's MCP (chrome-devtools, vidin) stayed visible.
- Both sides run Sonnet 5.5 high.
- Postgres `gf-experiment-postgres` 127.0.0.1:55433 (databases `ghostfolio_classic`/`ghostfolio_tagma`), Redis `gf-experiment-redis` 127.0.0.1:56379 (db 0/1); compose at `/opt/workspaces/gf-experiment/compose.yml`. Baseline: 477/477 API tests.
- Cold start: neither side offers a first step (verified on live Claude Code; no hints found in the Tagma app), first message is task 1.
- 9 tasks, each a new thread on both sides, verbatim identical text; three corrections C1–C3 said once and only on violation. Task and correction texts in thread `01a125fe-…` (the scenario message).

**Observation.**
- Task 1, second run (server `6ce46cc8c3`; classic in `permissionMode: auto`). `c1b` `01a145b7-06b1-7d7a-8628-fcd5f027ef34`: 2:05, 17 model calls, input ≈0.89M, output 7.2k, 16 Bash + 3 edits, no commit, no permission questions. `t1b` `01a145b7-06b1-7d7a-8628-fcd6aa0c878a`: 6:37, input 2.37M, output 11.9k, 55 tool calls, commit `cac2c4eb2`.
- Solutions nearly match (endpoint next to dividends, `feeInBaseCurrency` sums by year, tests, typecheck). Differences: t1b groups by UTC year, c1b by local; t1b writes `feeInBaseCurrency ?? 0`.
- Ghostfolio pre-commit (`affected:lint` + `format:check`) refused t1b's first `submit_work`; the refusal cut the git output to `✔ nx run common:…`, the agent found the cause itself (eslint, prettier) — about three extra steps. Classic never reached the hook: no commit asked.
- Task 1, third run (server `bd5a398723`: autocut? no — autocommit off by default, hook-output tail, `bash` without mandatory `description`). `c1c` `01a1461e-adea-7081-9373-24bf9641e263`: 3:13, 13 model calls, input 0.69M, output 7.2k, 15 Bash. `t1c` `01a1461e-adec-71af-8ed8-87540cf63e63`: 4:32, 21 steps, input 1.78M, output 12.1k, 51 tool calls (18 read, 11 grep, 12 edit). Neither side committed. t1c again writes `feeInBaseCurrency ?? 0` and groups by UTC year. c1c changed the response shape vs c1b (`{ baseCurrency, fees: [{ year, fee }] }`, no `range`, `null` in the closed view) — one model's spread across runs.
- Task 1, agent `tagma-shellread` (personal definition: extends tagma, capabilities graph/files/shell/skills, without read/grep/glob tools; prompt bans on sed/cat kept). `s1` `01a1462c-eb9e-7a6e-b823-eae2e5dbb406`: 2:18, 22 steps, input 1.05M, output 9.0k, context 31.5k → 60.3k. First call reached for `grep` (not in the set), then read and searched via `rg`, `sed -n`, `head` in bash, edited via `edit`. Solution at the t1c level, plus a CHANGELOG entry.
- Task 1, tagma agent on build `89048b7d42` (grep/read in Claude Code form, `edabb38bb6`). `t1d` `01a14661-3d47-78d4-9577-1ecbd0209fe4`: 3:43, 22 steps, input 1.74M, output 10.3k, context 53.3k → 94.1k (+41k). In the last request, grep results 24.5k chars (largest: a content search for `feeInBaseCurrency|…` across all of `apps/api/src`, 10.2k), read 35.8k (windows of 120–290 lines). Tool schemas 71k chars, system prompt 41k.
- First run (c1/t1) invalid: the `.husky/_` defect in `submit_work`.
- **Recording a correction as law (task 2, many runs).** At first neither side saved a correction. Tagma's causes in turn: the prompt had no "norm → rule" path (added, `2f71c63d21`); a correction from a parent agent read as the agent's word, not the operator's (made `plain: true` mode, `0453fed01e` — the child hears the parent as the operator); the sentence in "Writing the Graph" rarely fired. After moving the instruction into the #rule tag description (`26978745aa`): Sonnet 5.5 high recorded the rule in 2 of 4 runs (t2f, t2g yes; t2h found three disabled duplicates and asked; t2i no). The difference is the first thought after the correction: named it a norm — recorded (at the turn's end); thought of code at once — did not record. Opus 5.5 high (t2o, 1 run) recorded the rule as the first step, before editing code. Claude Code saved nothing in any run (no CLAUDE.md, `memory/` empty).
- **Series 2–9 (Sonnet 5.5 high both sides, Tagma with `plain: true`, corrections via `send_task`).** Task 2 at Claude Code levelled with a separate c2f run before task 4 (its task-2 code rolled back in repeats). Norms at Tagma after tasks 2–4: C1 [[aa84c26e]] (recorded by Opus t2o, no sources), C2 [[34e7d61d]] (Sonnet t3, sources activities/import/`parseActivityDate`), C3 [[a2bf1786]] (Sonnet t4, sources activities/import/portfolio). Claude Code saved nothing after C1–C3.

| Task | Norm | Tagma | Claude Code |
|---|---|---|---|
| 6 base-currency yield | C1, C3 | followed both, citing the laws (`totalDividendInBaseCurrencyWithoutCurrencyEffect`, an error on a missing rate) | changed nothing ("already there"), not counted |
| 7 split-date fix | C2 | violated: local `parseISO` + `resetHours`; the rule was in the prompt, the agent judged split dates not "activity dates" | violated with the same code |
| 8 own performance range | C2 | local `from/to`, like the yearly ranges | same |
| 9 pairless currency via USD | C1 | followed: removed `?? 1` in `getExchangeRatesByCurrency`, citing the law; named `toCurrency` and left it | no new substitutions; asked via AskUserQuestion (answer "2" — an intervention) |

- Polygon commits: gf-tagma `06970d33c`…`1776a3d36`, gf-classic `689dcb5`…`ac6abeb` (all `--no-verify`).
- Tagma defects found and fixed along the way: `core` (`da4c4c329c`), prompt rework by agents (`8af9517957`), three launch/setup refusals (`643c94efda`), `plain` (`0453fed01e`), plain-CLI questions before the parent (`f8cc48ff97`), built-in `agent-definitions` skill (`d1ba0845a9`), explicit rule delivery `delivery` (`080a39346d`; after it C2 and C3 became `code`).

**Conclusion.** Partly confirmed. Where a norm is recorded as law and a task touches it (6, 9), Tagma followed it and cited it directly; Claude Code in the same tasks did not meet the situation (6) or introduced no new violation (9) — the series gave no direct contrast on C1/C3. On C2 both sides violated identically (7, 8): Tagma had the law in the prompt, but the "activity dates" wording did not extend to split and query-parameter dates — a norm's boundary is set by the words the agent recorded it in. Recording a correction on Sonnet is unreliable (~every other time), on Opus from the first step (1 run). Untested: repeatability (one run per task), tasks where Claude Code would have to meet the missing rate again; the task-6 scenario proved weak (the function already existed). Cost: on task 1 Tagma spent ~2–2.5× more input on the starting context.
