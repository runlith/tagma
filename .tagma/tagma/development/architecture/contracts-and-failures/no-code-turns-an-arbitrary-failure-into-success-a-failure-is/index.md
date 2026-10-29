---
id: 01a0ea9b-7911-79ce-8e1b-ad81ea465bed
title: "No code turns an arbitrary failure into success: a failure is handled by its condition, issued as a typed refusal, or declared best-effort with a reason"
ord: 1
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "swallowed-failures",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: .
---
No code turns an arbitrary failure into success: a failure is handled by its own condition, issued as a typed refusal, or declared best-effort with a reason. Forbidden are catch/catchEager/catchCause with an empty list, false, void, or default; Effect.ignore/ignoreCause/orElseSucceed on work whose failure changes the answer; catchTag/catchTags/catchReason/catchReasons/catchIf/catchFilter/rescue with a successful fallback orElse. A failure is handled by tag or converted to a typed refusal. Best-effort cleanup, telemetry, and release after a failure need an exact allowance in config: file, symbol, shape, place, and one why line. The check is the swallowed-failures builtin.
