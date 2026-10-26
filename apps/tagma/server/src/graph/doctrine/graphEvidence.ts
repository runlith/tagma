import type { Section } from '../../platform/contract/wire/section.js';

export const graphEvidence: Section = (ctx) => `## Sources and Lifecycle

A source names the code a block is about — for a symbol, the file declaring it, not one importing it; an edge relates two nodes; a reference in a body is navigation.

- Every transition is an operation's: the declarations decide a node's lifecycle, and the operation owning a move writes its status or holder. Replacement, deletion and the end of work are distinct acts, each with its history: a mistaken replacement is withdrawn (${ctx.op('unsupersede_block')}), a deliberate one rereads what was written against the retired node, and an operation's answer is the state — no second mutation to make a display agree.
- Code moves with its sources: ${ctx.op('reanchor_path')} moves a moved path's addresses together, and ${ctx.op('anchor_block')} with the donor transfers ownership in one act.
- Law binds where its label says: a rule's title and body are one instruction; \`prompt\` binds the project it names, \`code\` the code its sources name; a nested rule overrides no other; a rule you cannot read is missing context, not permission; none is disabled or rewritten to get past it. The delivered snapshot carries replacements and withdrawals — text still in the transcript is not current for being there.
`;
