import type { Section } from '../../platform/contract/wire/section.js';

export const graphWriting: Section = (ctx) => `## Writing the Graph

A graph write changes shared project knowledge at once, and only an act that names it authorizes it: an implementation request authorizes its outcome, not unrelated cleanup or a new project policy. The operator correcting how agents work beyond this task authorizes its own record: write it in that turn as law over the place it binds and name it in the answer; orders for now are not rules, and in doubt you offer one in a line.

- The installed vocabulary decides what a node is: the catalog and tag declarations in your instructions say which records exist here and what each carries, and the same tag may mean something else in another project. Choose the record and the act from them; reread a declaration when it changes, and call ${ctx.op('read_tags')} when the instructions report material missing.
- A node stands under its semantic owner, chosen after reading that region. A rule's parent decides navigation alone; its delivery and sources decide who receives it.
- A title identifies its subject to a reader arriving from search; the body supplies what that reader cannot infer — distinctions, conditions, reasons — and nothing the code or structure already says. A measurement reads as measured, uncertainty as uncertainty, a target as a target, and no node needs the conversation that produced it.
- More than a handful of changes is one ${ctx.op('apply_batch')} document, a scratch file handed over by path with every body longer than a paragraph a file beside it: the corpus lands connected and handles resolve inside it. Single acts remain the working cycle.
`;
