import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Queue } from 'effect';
import { TerminalRequests, Terminals, type TerminalStart } from '../../executions/contract/service/terminals.js';
import { TerminalWriting } from '../../executions/contract/service/writing.js';
import { ExecutionRecords } from '../../executions/contract/service/records.js';
import { Discharge } from '../../executions/contract/service/discharge.js';
import { HostManagement } from '../../executions/contract/service/host.js';
import type { ResolvedExecutionTarget } from '../../executions/contract/wire/targets.js';
import { Settings } from '../../settings/contract/service/values.js';
import { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../platform/contract/service/credentials.js';
import { ScratchAreas } from '../../threads/contract/service/scratch.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { providerCatalogOf, staticRegistry } from '../../providers/testing/registry.js';
import { noInstalls } from '../../providers/testing/holders.js';
import { SessionObservations } from '../contract/service/observations.js';
import { hookReports } from '../testing/hookReports.js';
import { transcriptFiles } from '../testing/files.js';
import { keyboardRecord } from '../testing/keyboard.js';
import { standingAlignment } from '../testing/alignment.js';
import { SessionRoots } from './roots.js';
import { SessionLauncher } from './launcher.js';

const unused = () => Effect.die('The plain CLI launch does not use that boundary.');
const uncalled = (): never => {
  throw new Error('The plain CLI launch needs no grant, scratch or host connection.');
};

it.effect('a plain CLI reaches the host with its chosen permission mode, verbatim task and own home, with no Tagma credentials', () =>
  Effect.gen(function* () {
    const memory = yield* transcriptFiles();
    const world = yield* hookReports({ name: 'claude-code', key: 'root', access: memory.access });
    const record = keyboardRecord();
    const requests = yield* Queue.unbounded<TerminalStart>();
    const target: ResolvedExecutionTarget = {
      projectId: 7,
      binding: memory.binding,
      footprint: {
        status: 'complete',
        resource: { namespaceId: memory.binding.namespaceId, path: '/project' },
        witness: memory.binding.identityWitness,
        registryRevision: 0,
        roots: [],
      },
    };
    const ports = yield* Layer.build(
      Layer.mergeAll(
        Layer.mock(Terminals, {
          target: () => Effect.succeed(target),
          start: (request) =>
            Effect.as(Queue.offer(requests, request), {
              _tag: 'Started',
              operation: { installation: record.execution.installation, operation: request.operationId },
              record,
            }),
        }),
        Layer.mock(TerminalWriting, { agentGrant: uncalled, grantCounts: uncalled, lanesOver: uncalled }),
        Layer.mock(ExecutionRecords, {}),
        Layer.mock(TerminalRequests, {}),
        Layer.mock(Discharge, {}),
        Layer.succeed(HostManagement, {
          standing: Effect.succeed({
            get boot() {
              return uncalled();
            },
            custodian: true,
            detail: 'scripted host',
            geometry: { rows: 24, columns: 80 },
            notice: null,
          }),
          get connection() {
            return uncalled();
          },
        }),
        Layer.mock(Settings, { value: (key) => Effect.succeed(key.fallback) }),
        Layer.mock(GrantSigner, { grantFor: uncalled, threadOf: uncalled }),
        Layer.mock(ScratchAreas, { root: '/scratch', directory: uncalled, scope: uncalled }),
        Layer.mock(HarnessAccounts, {}),
      ),
    );
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          plain: true,
          home: '/profiles/classic',
          permissionMode: 'manual',
          session: { ...facet.session!, state: 'starting', ownerId: 'launcher', prompt: 'Build the floor.', argv: null },
        },
        value: undefined,
      }),
    );
    const terminals = Context.get(ports, Terminals);
    const roots = new SessionRoots(
      Context.get(ports, ScratchAreas),
      world.store,
      memory.access,
      terminals,
      Context.get(ports, TerminalWriting),
      Context.get(ports, ExecutionRecords),
      Context.get(ports, Discharge),
      Context.get(world.ports, SessionObservations),
      unused,
      unused,
      world.adapters,
    );
    const launcher = new SessionLauncher(
      world.store,
      terminals,
      Context.get(ports, TerminalRequests),
      Context.get(ports, HostManagement),
      Context.get(ports, Settings),
      Context.get(ports, GrantSigner),
      Context.get(ports, HarnessAccounts),
      staticRegistry(providerCatalogOf([])),
      Context.get(ports, ScratchAreas),
      roots,
      standingAlignment(world.store),
      () => Effect.succeed({ projectId: 7, root: '/project' }),
      'launcher',
      [],
      unused,
      unused,
      unused,
      memory.files,
      unused,
      world.adapters,
      noInstalls,
    );
    const facet = (yield* world.store.read(world.id))!;
    yield* launcher.launch(world.id, facet, facet.session!, true, false);
    const request = yield* Queue.take(requests);
    expect(request.program).toBe('claude');
    expect(request.args).toEqual(['--permission-mode', 'manual', '--resume', 'root', '--', 'Build the floor.']);
    expect(request.environment?.entries).toContainEqual({ _tag: 'Set', name: 'CLAUDE_CONFIG_DIR', value: '/profiles/classic' });
    expect(request.environment?.entries).toContainEqual({ _tag: 'Unset', name: GRANT_VARIABLE });
    expect(request.environment?.entries).toContainEqual({ _tag: 'Unset', name: SESSION_TOKEN_VARIABLE });
    expect((yield* world.store.read(world.id))?.session?.state).toBe('running');
    expect((yield* world.store.read(world.id))?.execution).toEqual({
      execution: record.execution.execution,
      incarnation: record.execution.incarnation,
    });
  }),
);
