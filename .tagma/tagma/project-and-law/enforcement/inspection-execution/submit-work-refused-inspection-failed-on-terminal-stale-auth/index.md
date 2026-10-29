---
id: 01a12ca0-bf6c-7ad7-a180-7de7c0628bf9
title: submit_work refused inspection-failed on terminal-stale-authority of the law checker; the unchanged retry landed
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: checker runlith-law ended and its console could not be read: terminal-stale-authority; an identical second call landed fd58ffb111 a few seconds later.",
    "command": "submit_work {subject, paths: [\"packages/chat-ui\"]} in /opt/workspaces/runlith",
    "expected": "The gated rule d81b1676 judges the change and the commit lands in one call."
  }
---
Matched with fix e3d3ce1d92: `enforcement/programs/group.ts` → `terminalProgramRoad` → `admittedWatch` uses the same Observe/Await recheck as the internal git. Releasing `rootUse` when the checker ends changed the old binding; the current stable admission projection keeps the read, as confirmed by the red→green test in the [[536ffde9|authority fix task]]. The rerun's historical success agrees with this race. Per the launching agent, the running server still uses the build made before the fix; applying the commit to it remains the operator's action.
