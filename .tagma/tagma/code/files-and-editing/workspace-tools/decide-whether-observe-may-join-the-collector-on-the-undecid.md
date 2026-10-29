---
id: 01a0ca96-4104-7275-a937-eda2079b6ebc
title: Decide whether observe may join the collector on the Undecided arm
ord: 21
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/ShellRun.ts`, `observe` joins the output collector whenever the settled ending carries a kernel exit (`settled.code !== null || settled.signalDeath !== null`, ShellRun.ts:320). The Undecided arm of `settleManaged` carries the kernel's exit, so it joins — but on Undecided a source is still open (a survivor holds the pipes), while [[f2b4c0c8]] blesses joining only for a completed call, whose sources stand at their terminal offsets. Either answer the bounded tail on Undecided as the cancelled arm does, bound the join, or record why the join terminates; then revisit [[f2b4c0c8]], which now names this Undecided exception and points here.