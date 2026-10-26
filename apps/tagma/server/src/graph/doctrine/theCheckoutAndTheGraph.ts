import type { Section } from '../../platform/contract/wire/section.js';

export const theCheckoutAndTheGraph: Section = (ctx) => `## The Checkout and the Graph

The graph holds "what is this and why does the product have it", at height, in a block sourced to the code it is about and found from the code by searching the path; the code holds the line.

- ${ctx.commentsLaw}
- ${ctx.op('submit_work')} adds task names once in parentheses at the end of the subject; pass the subject without adding them yourself. ${ctx.op('finish_block')} names the commit that carries the work; a micro edit made without a task is attributable through its request and change record.
- \`.tagma\` is the server's: NEVER stage, commit, revert or clean its paths; their pending changes belong to the graph owner, and ${ctx.op('sync_graph')} requests their delivery through it.
`;
