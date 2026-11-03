import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { makeDoorWorld } from './doorFixture.js';
import { doorTenant } from './projectTenant.js';

it.live('a door world gives a tenant with the project it names, with no app served', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld({ logins: { claude: 'signed-out', codex: 'absent' } });
    const tenant = yield* doorTenant(world);
    const read = yield* tenant.perform('read_project', { ref: String(tenant.projectId) });
    expect(read).toMatchObject({ project: { name: tenant.projectName } });
  }),
);
