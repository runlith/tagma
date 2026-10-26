import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Context } from 'effect';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { MCP_SESSION_HEADER } from '../../platform/contract/wire/session.js';
import { TERMINAL_HEADER } from '../../platform/contract/service/credentials.js';
import { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { ServedGraphs } from '../../graph/contract/service/serving.js';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { admission } from './admit.js';
import type { ThreadPlaces } from './standing.js';
import type { Devices } from '../../remote/contract/service/devices.js';
import type { OperationCatalog } from '../contract/service/catalog.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { identityOf } from './identity.js';

const resolution = SessionResolution.of({ resolve: () => Effect.succeed(null) });
const headers = { [MCP_SESSION_HEADER]: 'claude-code:external', [TERMINAL_HEADER]: 'shell-key' };
const failed = new EffectDrizzleQueryError({ query: 'select', params: [], cause: new Error('store closed') });
const machine = (read: MachineUnits['Service']['read']): MachineContext =>
  Context.make(MachineUnits, { read } as MachineUnits['Service']).pipe(
    Context.add(MachineStore, {} as MachineStore['Service']),
  ) as unknown as MachineContext;

it.effect('a failed shell-key read refuses rather than downgrading the session', () =>
  Effect.gen(function* () {
    const result = yield* Effect.flip(
      identityOf(
        machine(() => Effect.fail(failed)),
        resolution,
        testGrantSigner,
        headers,
      ),
    );
    expect(result.code).toBe('graph-pool');
  }),
);

it.effect('an unmatched shell key keeps the declared external session', () =>
  Effect.gen(function* () {
    const result = yield* identityOf(
      machine((work) => work({} as never)),
      resolution,
      testGrantSigner,
      headers,
    );
    expect(result.session).toEqual({ harness: 'claude-code', key: 'external' });
    expect(result.native).toBeNull();
  }),
);

it.effect('admission returns one operator identity and checkout place for an unsigned call', () =>
  Effect.gen(function* () {
    const machine = Context.make(Projects, {} as Projects['Service']).pipe(
      Context.add(ProjectIdentification, ProjectIdentification.of({ identify: () => Effect.succeed({} as never) })),
    ) as unknown as MachineContext;
    const result = yield* admission({
      machine,
      pool: {} as ServedGraphs['Service'],
      scratch: {} as ScratchAreas['Service'],
      origins: {} as WorkingOrigins['Service'],
      resolution,
      grants: testGrantSigner,
      devices: {} as Devices['Service'],
      places: {} as ThreadPlaces,
      catalog: {} as OperationCatalog['Service'],
    }).admit({}, { project: undefined, cwd: undefined, branch: undefined, scope: undefined }, null);
    expect(result.caller.actor).toEqual({ kind: 'operator' });
    expect(result.place).toBeNull();
    expect(result.world).toBe('checkout');
  }),
);
