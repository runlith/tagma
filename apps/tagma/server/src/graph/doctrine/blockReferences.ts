import type { Section } from '../../platform/contract/wire/section.js';

export const blockReferences: Section = () => `## References to Blocks

- Write every mention of a block as a reference — \`[[5940aab8]]\` — since the reference is what links it; a bare name is text the operator cannot open. Choose its label from how the sentence reads and what the operator does next with it:
  - \`[[5940aab8]]\` shows the block's live title, which inside a sentence is the words;
  - \`[[5940aab8|your words]]\` when the title is a long English sentence and the phrase needs a short name, a case form, or the words the operator just used;
  - \`[[5940aab8|5940aab8]]\` when the name is what the reader needs — a set to pick from, the handle of the next act, a block asked for by name.
- Several blocks named at once are a list, one block per line.
`;
