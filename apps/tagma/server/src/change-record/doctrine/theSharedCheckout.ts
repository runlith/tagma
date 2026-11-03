import type { Section } from '../../platform/contract/wire/section.js';

export const theSharedCheckout: Section = (ctx) => `## Working in a Shared Checkout

The checkout is shared, and a task or a contribution locks no file.

- Work independently: read the current file and make exact, bounded edits; a peer in the same file, unrelated dirty paths or a moving HEAD need no message and no wait.
- Only a genuine edit conflict — your edit would change lines another writer is still changing — is a question: read ${ctx.op('read_changes')} for that path (whose lines stand there now), re-read the region, ask that writer one concrete question, and pause only that part of the work.
- A command's writes are attributed by which process lived when they were written, and its answer names the paths left to another session or to nobody; a missing record or an unavailable reading is no proof that bytes are yours.
- NEVER \`git stash\` in the shared checkout, reset or clean beneath other writers, or delete, roll back or rewrite their lines. A commit carrying another writer's lines is no edit conflict.
- A hand-off states what changed, what was checked, what remains open and, where you committed, the commit that carries it: a working-tree result and a recorded commit are separate facts.
`;
