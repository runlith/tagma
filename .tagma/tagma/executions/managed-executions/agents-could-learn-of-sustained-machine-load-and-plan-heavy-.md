---
id: 01a18453-4e35-79d6-84f2-7f64eb2938fc
title: Agents could learn of sustained machine load and plan heavy commands around it
ord: 95
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0cf70-8db6-7877-9fee-457952791797
  - kind: relates
    to: 01a1649b-b78d-755e-b97c-6bc9d9ed050e
  - kind: relates
    to: 01a16e9f-fb23-7b11-b22d-3d14f7db8209
---
**Question.** Should agents learn about sustained machine load without asking for it, so each one decides before a heavy launch — tests, typecheck, build — whether to run it now, run a lighter or less parallel variant, or wait?

**Motivation.** Many agents work at once and each launches heavy commands on its own judgement. An agent sees the machine's load only when it chooses to look (`read_machine_load`, a shell command, performance reads), so it usually launches blind, and several agents pile heavy work onto an already loaded machine.

**What stands today.** The testbed already splits one machine budget between concurrent runs and lets a command cap its own process count (a number left in the runner command, `test:all --jobs N`), per [[f7db8209]]. Agents can subscribe to threads ([[d9ed050e]]), but not to machine state. [[52791797]] covers the host side: holding commands back by measured load instead of by the agent's choice.

**Shapes considered.**
- A notice delivered to working agents at their next step when load rises and holds — a sustained level over a window of several seconds, not a spike — and when it falls back. Who launched the load could ride the notice.
- A subscription an agent takes on machine load, waking it when load drops, so it can wait for room instead of polling.
- An explicit, documented way for an agent to ask the testbed for a light run (fewer workers) when speed does not matter.

**What would inform the choice.**
- Whether the testbed budget and host-side admission ([[52791797]]) already prevent the overload; if so, this idea is unneeded.
- Whether agents actually change behaviour on such notices, or the notices only cost context in every working thread.
- The threshold and window that separate "someone started something heavy" from noise, derived per machine rather than fixed.
- Whether the signal is per machine or also attributes load to threads and commands.

**Uncertainty.** Unmeasured: how often agent overload happens with the current testbed budget, and whether informed agents would wait or run lighter.
