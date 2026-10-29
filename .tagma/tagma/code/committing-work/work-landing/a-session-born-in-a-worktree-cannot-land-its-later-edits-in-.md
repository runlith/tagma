---
id: 01a10bed-7103-78b2-be14-f0bac626af38
title: "A session born in a worktree cannot land its later edits in main: submit_work sees nothing, and the parent's taking sees nothing either"
ord: 45
tags: ["reflection"]
fields:
  {
    "actual": "Child: submit_work/check_rules answer \"nothing\" (session bound to the acp-transport tree). Parent: taking answers \"nothing to commit\". The only road was staging by hand + commit_checkout, which also skips the per-session separation of a peer's lines in shared files; build-acp-ui hit the same twice (0e6f289323, ed650cf857).",
    "command": "After worktree acp-transport merged into main, children placed in that worktree were tasked to work in /opt/workspaces/runlith. build-claude-runner (01a10949…) edited ~20 files in main; then submit_work (child) and submit_work(taking: [child]) from the parent in main.",
    "expected": "read_changes attributes the main-checkout lines to the child, so the child's submit_work lands them, or the parent's taking carries them."
  }
---
Filed from project `runlith`.