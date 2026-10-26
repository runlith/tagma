import { Data } from 'effect';
import { agentDefinitions } from './agentDefinitions.js';
import { answering } from './answering.js';
import { deciding } from './deciding.js';
import { delegation } from './delegation.js';
import { holdingAPosition } from './holdingAPosition.js';
import { orchestration } from './orchestration.js';
import { preamble } from './preamble.js';
import { refusals } from './refusals.js';
import { threadsAsEvidence } from './threadsAsEvidence.js';
import { writing } from './writing.js';
import type { DoctrineSection } from '../../platform/contract/wire/section.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import { assembliesOf } from './assemblies.js';

export const SECTIONS = {
  'agent-definitions': {
    id: 'agent-definitions',
    owner: 'threads',
    render: agentDefinitions,
    path: 'src/threads/doctrine/agentDefinitions.ts',
    place: { prompt: 190, law: 20 },
  },
  answering: {
    id: 'answering',
    owner: 'threads',
    render: answering,
    path: 'src/threads/doctrine/answering.ts',
    place: { prompt: 220, base: 40 },
  },
  deciding: {
    id: 'deciding',
    owner: 'threads',
    render: deciding,
    path: 'src/threads/doctrine/deciding.ts',
    place: { prompt: 240, base: 50, law: 130 },
  },
  delegation: {
    id: 'delegation',
    owner: 'threads',
    render: delegation,
    path: 'src/threads/doctrine/delegation.ts',
    place: { 'ORCHESTRATION.md': 10 },
  },
  'holding-a-position': {
    id: 'holding-a-position',
    owner: 'threads',
    render: holdingAPosition,
    path: 'src/threads/doctrine/holdingAPosition.ts',
    place: { prompt: 250, base: 60 },
  },
  orchestration: {
    id: 'orchestration',
    owner: 'threads',
    render: orchestration,
    path: 'src/threads/doctrine/orchestration.ts',
    place: { 'ORCHESTRATION.md': 20 },
  },
  preamble: {
    id: 'preamble',
    owner: 'threads',
    render: preamble,
    path: 'src/threads/doctrine/preamble.ts',
    place: { prompt: 10, base: 10 },
  },
  refusals: {
    id: 'refusals',
    owner: 'threads',
    render: refusals,
    path: 'src/threads/doctrine/refusals.ts',
    place: { prompt: 120, base: 30, law: 110 },
  },
  'threads-as-evidence': {
    id: 'threads-as-evidence',
    owner: 'threads',
    render: threadsAsEvidence,
    path: 'src/threads/doctrine/threadsAsEvidence.ts',
    place: { prompt: 180 },
  },
  writing: { id: 'writing', owner: 'threads', render: writing, path: 'src/threads/doctrine/writing.ts', place: { prompt: 20, base: 20 } },
} satisfies Record<string, DoctrineSection>;

export type SectionId = string;

export class ContributionInvalid extends Data.TaggedError('ContributionInvalid')<{ readonly id: string; readonly message: string }> {
  constructor(id: string, reason: string) {
    super({ id, message: `The doctrine section ${id} ${reason}.` });
  }
}

export function isOwn(id: SectionId): id is keyof typeof SECTIONS {
  return Object.hasOwn(SECTIONS, id);
}

export function contributions(sections: readonly DoctrineSection[]): SectionCatalog {
  const filled = new Map<string, DoctrineSection>();
  for (const section of sections) {
    if (filled.has(section.id)) throw new ContributionInvalid(section.id, 'is filled twice');
    filled.set(section.id, section);
  }
  return { sections: Object.freeze(Object.fromEntries(filled)), assemblies: assembliesOf(sections) };
}

export function sectionPath(id: SectionId, contributed: SectionCatalog): string {
  const section = contributed.sections[id] ?? (isOwn(id) ? SECTIONS[id] : undefined);
  if (section === undefined) throw new ContributionInvalid(id, 'has no declared source');
  return section.path;
}
