---
id: 01a12c93-2c80-7367-aa96-b8e2b991cf74
title: Bash reports attribution of unchanged files that left the dirty set after someone else's commit
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The command finished the tests and reported \"9 files moved while this ran; 8 attributed to this session\". read_changes after it showed only five files this session had already written; no new paths appeared in history. One extra read was needed to tell the command's report from real authorship.",
    "command": "bash(command=\"bun test --parallel=1 ./src/shellShown.test.ts\", workdir=\"/opt/workspaces/runlith/packages/agent-tools\")",
    "expected": "Unit tests do not write the checkout; someone else's files leaving the dirty set after HEAD moves counts as no command write when their bytes and presence are unchanged."
  }
---
Filed from project `runlith`.

A controlled integration test confirmed the cause: a peer commit moves HEAD and drops a file from the dirty set, though bytes and presence stay the same. movedPaths correctly yields a re-read candidate, but ShellRun.movesOf did not discard equal digest/presence. The result wrongly called that path moved/attributed; now equality is checked before the authorship decision and the answer is formed.
