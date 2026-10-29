---
id: 01a16521-1dc1-7e00-b6a4-4476f3bd1b25
title: "Step 18 — formatting at commit: shape and refusal work, a rule refusal over the formatted tree cannot be explained from the working file"
ord: 36
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "unclear"
  }
---
**Hypothesis** — the format command from `tagma.config.ts` formats every `submit_work` commit, the working file receives the same shape, a formatter failure refuses the whole commit, and rules judge the already formatted tree in a way the agent understands.

**Setup** — law-lab (project 39). There was no formatter: `prettier@3` added (devDependency, `bun add`), a base run over `apps/**/*.{ts,tsx}` and `packages/**/*.{ts,tsx}` — 17 files, +194/−39, tests 18/18 — as a separate commit `ef699fc3e4`. Then `format.prettier` = `Format.command({ run: [prettier, --write, --log-level, warn], files: same coverage, reads: 'nearby' })`, commit `1b574fe7da`. Caller — a thread with a runlith home.

**Observation**
- Edit `export function   invert( rateCents:Cents ):number{ return 1/rateCents }` → `submit_work` landed (`9ff6f58f06`), formatted shape in the commit and in the working file; the reply names the rewritten file.
- Syntax error → refused `format-failed`: exit code 2, prettier stderr with place, three ways out (fix the file, add the code to `ok`, exclude the file); nothing committed.
- One long object line in `expenses.ts` (working file 86 lines) → both `check_rules` and `submit_work`: "holds 125 lines … over 120". Rules judge the formatted tree — consistently. But the refusal does not say that 125 is the shape after prettier while the working file stays 86 lines — the agent cannot match them. Reflection [[88ccb5a3]].
- Edits dropped, law-lab clean.

**Conclusion** — formatting at commit works: shape, working file, refusal on failure. Defect: a rule refusal over the formatted shape cannot be explained from the working file. Not checked: a file with another session's lines (a reflection on formatter line authorship, de82b2fc, already stands), `reads: 'tree'`, `commit_checkout`.
