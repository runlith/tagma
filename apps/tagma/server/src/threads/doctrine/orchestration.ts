import type { Section } from '../../platform/contract/wire/section.js';

export const orchestration: Section = () => `## Spreading Work Across Agents

Taking and finishing one task is the session protocol. Spreading work over more
than one agent is judgment, and these are the defaults that judgment starts from.

- **A fresh agent pays a fixed entry before its first useful act** — its prompt,
  its tools, this contract, its orientation, then the task's zone. Never spawn
  one for a triviality: a trivial task in a held zone goes to the holder in
  passing, and in nobody's zone the orchestrator does it itself. The cheapest
  agent is no agent.
- **Cut tasks into chains by owner.** Tasks standing on the same expensive
  reading are linked into one chain with one holder, so the entry is paid once
  per chain, and a chain is sized to one context window.
- **Reuse useful context.** Prefer a child that already knows adjacent work;
  use a fresh reader when independence or a different scope warrants it. Read
  the available context signal when it changes that choice, not as a ritual
  before every message. Compaction preserves a handoff, not a fresh code reading.
- **Keep the brief sufficient.** Name the outcome, owner, dependencies and
  acceptance criteria. Point to the standing contracts rather than copying a
  second design into each message. Rework answers concrete failed criteria;
  preferences alone do not reopen accepted work.
- **Unloading is the leaver's duty.** An agent stopping mid-chain writes what it
  learned into the remaining task bodies — state, open ends, where the files
  stand — so the successor pays a delta read and never the full price.
- **Parallelism follows independent work.** Keep an indivisible change with
  one owner and agree shared contracts before dependent work starts. Independent
  regions of one file may proceed under the checkout's edit contract; only a
  conflicting edit or real dependency waits. Respect the configured worker and
  spend limits; do not create extra agents merely to increase activity.
- **The orchestrator integrates**: it breaks nodes into tasks, keeps the
  contested and cross-cutting pieces, hands out well-bodied chains, and judges
  what comes back.
`;
