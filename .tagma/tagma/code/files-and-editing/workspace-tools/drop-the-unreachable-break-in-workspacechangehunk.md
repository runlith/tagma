---
id: 01a0ca9f-362c-77a8-97a8-599c23c58850
title: Drop the unreachable break in workspaceChangeHunk
ord: 26
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/WorkspaceChanges.ts`, the `break` in `workspaceChangeHunk`'s growth loop is unreachable: it fires only when the before-window is the whole before text, at which point the after-window is necessarily the whole after text too (both ends grow together from the same tail), and a whole text stands exactly once in itself — so the loop's uniqueness condition already exits first. Beyond dead, the arm masks bugs: were whole-text uniqueness ever to break, it would silently file a non-unique hunk. Drop the arm (WorkspaceChanges.ts:98); the loop still terminates by uniqueness — a whole text stands exactly once in itself, so the condition exits first.