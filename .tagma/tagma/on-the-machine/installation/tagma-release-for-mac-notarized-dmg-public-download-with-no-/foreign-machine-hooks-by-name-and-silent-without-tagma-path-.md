---
id: 01a1320b-f684-783b-8220-2a7a7fd7e734
title: "Foreign machine: hooks by name and silent without Tagma, PATH from the server's login shell, separate Tagma Dev app, first-run preconditions"
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
---
Spec sections "What breaks a foreign machine now" and "Signature before Developer ID" (two app identities). To do: hook — `command -v tagma >/dev/null 2>&1 || exit 0; exec tagma hook <verb>` in `external-harnesses/installs/hookInstall.ts`, `tagma upgrade` rewrites standing hooks, committed `.claude/settings.json` and `.codex/hooks.json` of this repo updated; server, whose PATH launchd gave it, takes PATH from `$SHELL -ilc` at startup with a timeout (single owner — server); developer install — Tagma Dev: own bundle id, `app.setName`, data directory; release — Tagma, `com.runlith.tagma`, `LSMinimumSystemVersion` 13 on the main app. Renaming the bundle id resets the operator's permissions once — say so in the report.

Done: hook stays silent without `tagma` and works with it from another HOME; server started from the Dock finds `claude` and git from Homebrew; Tagma Dev and release on one machine share neither single-instance lock nor data.
