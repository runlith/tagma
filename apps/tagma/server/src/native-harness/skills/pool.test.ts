import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import type { MemberSkills, SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
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
  project: null,
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
  members: [],
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

const member = (project: string, names: readonly string[]): MemberSkills => ({
  project,
  skills: names.map((name) => ({ id: name, description: `${project} ${name}.`, place: project, instructions: () => 'Do it.' })),
  inventory: names.map((name) => ({ ...own, name, description: `${project} ${name}.`, path: `/${project}/${name}/SKILL.md`, project })),
  rejected: [],
});

it.effect('a group member’s skill keeps its name unless this catalog or another member offers it, and no name hides another', () =>
  Effect.sync(() => {
    const grouped: WorkspaceInputSet = {
      ...sources(['beta-review']),
      skills: [...sources([]).skills, { id: 'beta-lint', description: 'Ours.', instructions: () => 'Ours.' }],
      inventory: [own, deployer, { ...deployer, name: 'beta-lint', path: '/repo/.agents/skills/beta-lint/SKILL.md' }],
      members: [member('alpha', ['deployer', 'review', 'release', 'lint']), member('beta', ['review', 'lint'])],
    };
    const pool = skillPool(shelf, grouped).flatMap((skill) => (skill.place === undefined ? [] : [[skill.id, skill.place]]));
    expect(pool).toEqual([
      ['alpha-deployer', 'alpha'],
      ['alpha-review', 'alpha'],
      ['release', 'alpha'],
      ['alpha-lint', 'alpha'],
    ]);
    const inventory = skillInventory(shelf, grouped).flatMap(({ name, project, enabled, replacedBy }) =>
      project === null ? [] : [{ name, project, enabled, replacedBy }],
    );
    expect(inventory).toEqual([
      { name: 'alpha-deployer', project: 'alpha', enabled: true, replacedBy: null },
      { name: 'alpha-review', project: 'alpha', enabled: true, replacedBy: null },
      { name: 'release', project: 'alpha', enabled: true, replacedBy: null },
      { name: 'alpha-lint', project: 'alpha', enabled: true, replacedBy: null },
      { name: 'beta-review', project: 'beta', enabled: false, replacedBy: null },
      { name: 'beta-lint', project: 'beta', enabled: false, replacedBy: 'project' },
    ]);
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
