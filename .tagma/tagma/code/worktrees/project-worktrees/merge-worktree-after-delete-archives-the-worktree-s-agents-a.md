---
id: 01a1464e-8eb6-79d1-8450-da3bb53a410b
title: merge_worktree after:delete archives the worktree's agents, and later send_task to them lies stored without ever starting
ord: 24
tags: ["reflection"]
fields:
  {
    "actual": "send_task answered acted:true status:\"stored\" runId:null; no run started for ~45 minutes, and a follow-up send_message also answered \"stored\". The parent only noticed by reading the agents' run list; work on two streams silently stalled.",
    "command": "merge_worktree rootId=<ai-core> after=delete; then send_task to=[ai-core] (and ai-media) with new work in main",
    "expected": "Either the agents move to main and stay addressable, or send_task refuses saying the thread is archived."
  }
---
Filed from another project.