---
id: 01a1659b-6e2b-7ecb-910f-4428c1f0740b
title: "Step 20 — live re-verification of the fixes after restart: all six work"
ord: 38
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — the fixes committed after steps 12, 16, 18, 19 and the abandoned platforms debt work on the live server after the operator's restart.

**Setup** — server restarted by the operator ~21:50 on 22.10; law-lab (project 39), rules [[4e5d1446]], [[13981632]], [[54911d80]]; runlith rule [[50520d64]]. Caller — a thread with a runlith home.

**Observation**
- Abandoned debt: the platforms rule in runlith — debt 4 → 0 since 10:19 (`0344810b`).
- Step 16: a `domain` test imports `@law-lab/ui` → the modules fix now names `imports-tests` (`importsTests` in `set_module`), production code stays closed; `set_module` domain importsTests ui recorded (earlier — a cycle). `ui → web` still refused, now `module-map-invalid` with a way out through `set_module`. The test is still refused by domain-no-ui — by design; the edit and the relation removed.
- Step 12: `git -c core.hooksPath=/dev/null commit` with `console.error` (`319018a`) → without a landing the re-measure recorded the escape `rates.ts:9 @ 319018a`; fix `59c63fbfd0` → escape dropped.
- Step 19: worktree `fast-merge`, `create_block` + `enforce_rule absorb` with WT checkout, `submit_work`, immediately `merge_worktree` → in main debt 3, entry `rates.ts → 4c5c6172`, escape 0.
- Fix in main `1cef1976f2`, immediately `finish_block` with that commit → no "remaining debt".
- Step 18: a line prettier unwraps to 125 > 120 → the refusal says "the format commands … rewrote expenses.ts, and every line and count above reads that form, which now stands in the working files"; the working file is 126 lines (formatted). Edit dropped.

**Conclusion** — confirmed: all six fixes work live. Not checked: review mode (needs the operator's root thread).
