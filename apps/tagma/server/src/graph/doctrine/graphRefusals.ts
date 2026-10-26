import type { Section } from '../../platform/contract/wire/section.js';

export const graphRefusals: Section = (ctx) => `## A Graph Refusal Is a Contract

A graph gate says no with a contract: a code naming the rule, a reason saying what happened to this block, and \`unblock\` — at least one way out, or the reason says why none can be suggested. The three fields reach every reader unchanged at every door.

- Satisfy the refusal's \`unblock\` list, or report what is missing.
- What refuses is structure, never rank: an illegal transition, a status on a kind that reports no work, a status a named operation owns, a source that no longer matches — none is a permission check, and no session outranks it. An act on what another session holds asks the operator under review and runs under trust and bypass; with nobody to ask, review refuses \`no-approver\`, and a caller that is no Tagma thread is never asked.
- A reference is judged twice: a word that is no block name fails its field before any gate runs, and a name fitting more than one block refuses \`ambiguous-name\` with the candidates. Write the name as a read printed it, and a block standing in several projects as \`<project id>/<name>\`, which every field naming a block takes.
- A block resting in the trash wants ${ctx.op('restore_block')}; a call that never connected wants the server — neither is a graph refusal.
`;
