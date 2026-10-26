import { Data } from 'effect';
import type { Assembly, DoctrineSection } from '../../platform/contract/wire/section.js';
import type { SectionAssemblies } from '../../platform/contract/service/sections.js';

export const SKILL_FILES = ['SKILL.md', 'LIFECYCLE.md', 'REVIEW.md', 'ORCHESTRATION.md', 'OPERATIONS.md'] as const;

const ASSEMBLIES = ['prompt', 'base', 'law', ...SKILL_FILES] as const satisfies readonly Assembly[];

export class SectionOrderConflict extends Data.TaggedError('SectionOrderConflict')<{
  readonly assembly: Assembly;
  readonly rank: number;
  readonly sections: readonly [string, string];
  readonly message: string;
}> {
  constructor(assembly: Assembly, rank: number, sections: readonly [string, string]) {
    super({ assembly, rank, sections, message: `The ${assembly} assembly places both ${sections[0]} and ${sections[1]} at ${rank}.` });
  }
}

export function assembliesOf(sections: readonly DoctrineSection[]): SectionAssemblies {
  const ranks = new Map<Assembly, Map<number, string>>(ASSEMBLIES.map((assembly) => [assembly, new Map()]));
  for (const section of sections) {
    if (Object.keys(section.place).length === 0) throw new Error(`The doctrine section ${section.id} reaches no assembly.`);
    if (section.place.base !== undefined && section.place.prompt === undefined)
      throw new Error(`The base section ${section.id} declares no prompt placement.`);
    const skill = SKILL_FILES.some((file) => section.place[file] !== undefined);
    if (section.place.law !== undefined && skill) throw new Error(`The doctrine section ${section.id} reaches both law and skill.`);
    for (const assembly of ASSEMBLIES) {
      const rank = section.place[assembly];
      if (rank === undefined) continue;
      const placed = ranks.get(assembly)!;
      const previous = placed.get(rank);
      if (previous !== undefined) throw new SectionOrderConflict(assembly, rank, [previous, section.id]);
      placed.set(rank, section.id);
    }
  }
  const order = (assembly: Assembly) => [...ranks.get(assembly)!].sort(([left], [right]) => left - right).map(([, id]) => id);
  return {
    prompt: order('prompt'),
    base: order('base'),
    law: order('law'),
    'SKILL.md': order('SKILL.md'),
    'LIFECYCLE.md': order('LIFECYCLE.md'),
    'REVIEW.md': order('REVIEW.md'),
    'ORCHESTRATION.md': order('ORCHESTRATION.md'),
    'OPERATIONS.md': order('OPERATIONS.md'),
  };
}
