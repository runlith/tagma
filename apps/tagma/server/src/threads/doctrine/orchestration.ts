import { DELEGATION_NORM } from '@runlith/agent/collaboration/CollaborationConfig';
import type { Section } from '../../platform/contract/wire/section.js';

export const orchestration: Section = () => `## Spreading Work Across Agents

Taking and finishing one task is the session protocol. Spreading work over more
than one agent is judgment, and these are the defaults that judgment starts from.

- ${DELEGATION_NORM}
- **Cut tasks into chains by owner.** Tasks standing on the same expensive
  reading are linked into one chain with one holder, so the entry is paid once
  per chain.
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
  spend limits.
- **An agent that spreads work integrates it**: it breaks nodes into tasks, keeps
  the contested and cross-cutting pieces, hands out well-bodied chains, and
  judges what comes back.
`;
