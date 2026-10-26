import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { SKILL_FILES } from '../../threads/doctrine/assemblies.js';
import { renderSection } from '../../threads/doctrine/render.js';
import type { SectionId } from '../../threads/doctrine/registry.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';

const SKILL_DESCRIPTION =
  'Use when working in a repository tracked by Tagma — the living project-knowledge graph (modules, specs, tasks and rules as blocks with lifecycle and gates). Trigger when the user asks ANY question about a tracked product — what it is, how a mechanism works, its architecture or status — and when they ask to find ready work, claim or close tasks, write or review specs, record decisions or divergences, or mention tagma, blocks, block names, prime, delta.';

function skillIndex(contributed: SectionCatalog): string {
  return SKILL_FILES.filter((file) => file !== 'SKILL.md')
    .map((file) => `- \`${file}\` — ${contributed.assemblies[file].map((id) => sectionHeading(id, contributed)).join('; ')}.`)
    .join('\n');
}

function sectionHeading(id: SectionId, contributed: SectionCatalog): string {
  const first = renderSection(id, { contributed }).split('\n', 1)[0] ?? id;
  return first.replace(/^#+\s*/, '');
}

export function installedBody(file: string, contributed: SectionCatalog): Buffer {
  const declared = SKILL_FILES.find((entry) => entry === file);
  if (declared === undefined) throw new Error(`The tagma skill ships no file named ${file}.`);
  const sections = contributed.assemblies[declared].map((id) => renderSection(id, { contributed }).trimEnd());
  const head =
    file === 'SKILL.md'
      ? [
          [
            '---',
            'name: tagma',
            `description: ${SKILL_DESCRIPTION}`,
            '---',
            '',
            '# Tagma',
            '',
            'The doctrine this skill adds to the Tagma law already in this repository’s agent file.',
            '',
            skillIndex(contributed),
          ].join('\n'),
        ]
      : [];
  return Buffer.from(`${[...head, ...sections].join('\n\n')}\n`, 'utf8');
}

export function sourceFiles(): string[] {
  return [...SKILL_FILES].sort();
}

export const filesUnder = Effect.fn('harnessInstall.filesUnder')(function* (dir: string) {
  const files = yield* FileSystem.FileSystem;
  const entries = yield* files.readDirectory(dir, { recursive: true });
  return (yield* Effect.filter(entries, (entry) => Effect.map(files.stat(join(dir, entry)), (info) => info.type === 'File'), {
    concurrency: 'unbounded',
  })).sort();
});
