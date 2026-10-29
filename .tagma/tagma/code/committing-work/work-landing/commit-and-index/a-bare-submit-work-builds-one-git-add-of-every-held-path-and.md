---
id: 01a0cafc-6baa-7b32-b6c6-f2074c216a8d
title: A bare submit_work builds one git add of every held path and overflows the host's 16 KiB call envelope
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "refused — \"git could not be started: git add could not be started: terminal-host-protocol: a Call header of 20130 bytes exceeds the 16384 byte envelope — report it against the host installation rather than retrying the call\", listing all 294 paths in one argv",
    "command": "submit_work with no paths, holding 294 files under packages/agent after strip_comments swept it",
    "expected": "One commit carrying the paths this session holds, or a refusal naming something the caller can act on"
  }
---
Filed from project `runlith`.

Measured 2026-09-22 on runlith at HEAD fa5da28cf3. 294 paths averaging about 62 characters made a 20,130-byte Call header against a 16,384-byte envelope, so the ceiling is reached somewhere near 240 paths of this repository's depth — well inside what one `strip_comments` over a package produces, and inside what a large refactor produces too.

The two failures compose into a hole with no way through the tool: the directory form answers `nothing` (586cb4ca), and the form that does gather the held paths cannot hand them to git. I committed by hand with `git add -- packages/agent && git commit`, which the doctrine allows, so the work landed as e61f131533 — but the commit carries no task references from the tool and the change record's authorship handling was bypassed.

`git add` accepts pathspecs on stdin (`--pathspec-from-file=-`), and a directory argument where every held path sits beneath one, so neither the envelope nor the path count has to bound this.