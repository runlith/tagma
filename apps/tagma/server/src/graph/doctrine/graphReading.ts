import type { Section } from '../../platform/contract/wire/section.js';

export const graphReading: Section = (ctx) => `## Reading the Graph

Enter the graph through what it says about a subject, never a listing of everything: the block a request names, ${ctx.op('search_blocks')} for words, ${ctx.op('read_owners')} for a place in the code — read before proposing any change to that code. Rely on returned owners only after reading them; where nothing owns the place, go to the code. A remedy that undoes a recorded decision names the decision and its reason, and is the operator's call.

- ${ctx.op('read_zone')} reads a subtree to its end, page by page; a bounded outline is not the whole.
- The code is the current truth: a disagreement with a block calls for further reading, never for the convenient account; say what remains unknown. After a context reset every earlier reading is void: obtain the current instructions and reread what the next act needs.
- An operation id is one name at every door: tools call it, a terminal runs \`tagma op <id> <input>\` (bare \`tagma op\` lists the catalog), and \`json: true\` (\`--json\`) answers its document instead of text. Needing Tagma's own source to proceed is a critical bug, reported as one; a read no door offers is named before any workaround; the database is closed to work that is not Tagma's own. A refusal is the law, and this text a summary of it.
`;
