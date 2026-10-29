import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import type { SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
import { skillInventory, skillPool } from './pool.js';

const unused = () => Effect.die('the shelf is not read by the skill catalog');

const shelf = ArtifactStore.of({
  publish: unused,
  draft: unused,
  list: unused,
  page: unused,
  versions: unused,
  pages: unused,
  follow: () => Stream.die('the shelf is not read by the skill catalog'),
  followPage: () => Stream.die('the shelf is not read by the skill catalog'),
  videos: unused,
  videoFile: () => null,
});

const LOCATION = '/repo/.agents/skills/showcase';

const own: SkillInventoryEntry = {
  name: 'showcase',
  description: 'Our own showcase.',
  path: `${LOCATION}/SKILL.md`,
  directory: '/repo/.agents/skills',
  scope: 'project',
  plugin: null,
  enabled: true,
  own: false,
  replacedBy: null,
};

const deployer: SkillInventoryEntry = { ...own, name: 'deployer', description: 'Ships.', path: '/repo/.agents/skills/deployer/SKILL.md' };

const sources = (disabled: readonly string[]): WorkspaceInputSet => ({
  contextFiles: [],
  shipped: [],
  skills: [
    { id: 'showcase', description: own.description, location: LOCATION, instructions: () => 'Show it our way.' },
    { id: 'deployer', description: deployer.description, instructions: () => 'Run it.' },
  ],
  disabledSkills: new Set(disabled),
  inventory: [own, deployer],
  rejected: [],
});

const offered = (input: WorkspaceInputSet, name = 'showcase') =>
  skillPool(shelf, input)
    .filter((skill) => skill.id === name)
    .map((skill) => skill.location ?? 'built-in');

const listed = (input: WorkspaceInputSet, name = 'showcase') =>
  skillInventory(shelf, input)
    .filter((entry) => entry.name === name)
    .map(({ scope, enabled, replacedBy }) => ({ scope, enabled, replacedBy }));

it.effect('a disabled project skill stays in the inventory but leaves the catalog', () =>
  Effect.sync(() => {
    expect(offered(sources(['deployer']), 'deployer')).toEqual([]);
    expect(listed(sources(['deployer']), 'deployer')).toEqual([{ scope: 'project', enabled: false, replacedBy: null }]);
  }),
);

it.effect('a project skill named like a built-in stands in for it once the built-in is switched off, and the inventory says so', () =>
  Effect.sync(() => {
    expect(offered(sources([]))).toEqual(['built-in']);
    expect(listed(sources([]))).toEqual([
      { scope: 'built-in', enabled: true, replacedBy: null },
      { scope: 'project', enabled: false, replacedBy: 'built-in' },
    ]);
    expect(offered(sources(['showcase']))).toEqual([LOCATION]);
    expect(listed(sources(['showcase']))).toEqual([
      { scope: 'built-in', enabled: false, replacedBy: 'project' },
      { scope: 'project', enabled: true, replacedBy: null },
    ]);
  }),
);
