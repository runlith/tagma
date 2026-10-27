import type { WorktreeFact } from '@tagma/server/worktrees/contract/wire/rows';

export const factTitle = (fact: WorktreeFact): string =>
  [
    `Fact: ${fact.state}`,
    fact.head === null ? null : `HEAD ${fact.head}`,
    fact.indexStamp === undefined ? null : `Index ${fact.indexStamp}`,
    fact.driverRevision === undefined ? null : `Graph driver ${fact.driverRevision}`,
    fact.fingerprint === undefined ? null : `Merge configuration ${fact.fingerprint}`,
    fact.base === null ? null : `Base ${fact.base}`,
    fact.baseTime === null ? null : `Base committed ${new Date(fact.baseTime).toLocaleString()}`,
    fact.takenAt === null ? null : `Taken ${new Date(fact.takenAt).toLocaleString()}`,
  ]
    .filter((part) => part !== null)
    .join('\n');
