---
id: 01a0c848-cf88-720f-88a0-167774c7ddcf
title: submit_work answers "nothing to commit" for files this session's own strip_comments wrote, and commits them only when the paths are named
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "\"nothing to commit — this session holds nothing the branch does not already carry\", while `git status` showed the stripped files modified. Naming each FILE explicitly in `paths` committed them; naming the package DIRECTORY did not.",
    "command": "strip_comments over a package, then submit_work with no paths (and with paths naming the package directory)",
    "expected": "The files strip_comments rewrote as this session's own recorded writes are carried by submit_work, as the operation's own words say: \"recorded as this session's own change, carried by submit_work like any other\"."
  }
---
Filed from project `runlith`.

Measured twice in one session, 2026-09-22, on the same checkout:

- `packages/floating-frame`: strip dropped 22 lines across 3 files; `submit_work` with `paths: ["packages/floating-frame"]` answered `nothing`; `read_changes` on one of those files answered "1 held change … this session · run 01a0c845-f54b-76ac-b0ca-024e56c04a32" — the hold was recorded under a DIFFERENT run of this same thread than the one calling submit_work. Re-calling with the three file paths landed commit 1c5ecde407.
- `packages/seam` + `packages/desktop-host`: strip dropped 66 + 5 lines; `submit_work` with the two directory paths answered `nothing`; the same call with the eight file paths landed d689cdf35a.

Earlier strips in this same thread committed without naming paths (989b34f7, cbb15a69, d94eb89f00), so the difference is not that directories never work — something about which run holds the lines decides it. The risk is silent: a session that trusts the `nothing` answer leaves a finished strip uncommitted and reports the zone as landed.