import type { DoctrineSection, Section } from '../../platform/contract/wire/section.js';

export const theOperations =
  (map: string): Section =>
  () =>
    `## Every Operation, by Owner

What each operation IS, from the catalog itself — so an operation that exists is an operation named
here. The mechanics of one, its fields and the codes it refuses with ride with the operation when
you call it; this is the inventory, not the manual. Every answer reads as text; \`json: true\` answers its
document instead. A terminal calls \`tagma op <id> <input>\`, \`--json\` for the document; \`tagma op <id> --help\`
reads that entry before the call.

${map}
`;

export type OperationTable = { readonly title: string; readonly entries: readonly { readonly id: string; readonly meaning: string }[] };

export const operationsSection = (tables: readonly OperationTable[]): DoctrineSection => ({
  id: 'the-operations',
  owner: 'composition',
  place: { 'OPERATIONS.md': 10 },
  render: theOperations(
    tables
      .map((table) => `**${table.title}**\n\n${table.entries.map((entry) => `- \`${entry.id}\` — ${entry.meaning}`).join('\n')}`)
      .join('\n\n'),
  ),
  path: 'src/threads/doctrine/operationsSection.ts',
});
