import type { Section } from '../../platform/contract/wire/section.js';

export const delegation: Section = () => `## Delegation

A subagent working the graph needs this contract before its first act — not a
claim, not a create, not one body. The sender names it in the prompt when the
subagent's harness carries it, and restates every decision the work depends on:
whatever the prompt omits, the graph loses.

A server brief is the exception, and it is self-contained by construction: it
carries what its reader must know and orders no reading it cannot hand over. That
is why a brief is handed over as the server printed it — a brief rewritten by
hand is where the law gets lost.

Delegation inherits nothing else. Whatever the next agent needs must be in the
task body and in the spec, which is the resumability test doing its job.
`;
