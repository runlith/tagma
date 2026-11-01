import { Clock, Context, Effect } from 'effect';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { ServedGraphs } from '../../graph/contract/service/serving.js';
import { ProjectIdentification } from '../../projects/contract/service/registry.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { WorkingOrigins } from '../../workspace/contract/service/places.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import type { Devices } from '../../remote/contract/service/devices.js';
import { Admission, type AdmittedCall, CallDevice, ConnectionHeaders } from '../contract/service/admission.js';
import { CallAuthority } from '../../platform/contract/service/authority.js';
import { admitCallers } from './callers.js';
import { admitRight } from '../../platform/contract/service/access.js';
import { operationCaller } from './actor.js';
import { admitProject, unopenedGraph } from './project.js';
import type { OperationCatalog } from '../contract/service/catalog.js';
import { carrying } from './services.js';
import { authorityOf, standingOf, type ThreadPlaces } from './standing.js';

const unread = (failure: GateRefusal | StoreFailure): GateRefusal =>
  failure instanceof GateRefusal
    ? failure
    : new GateRefusal('graph-pool', `this server could not read its devices: ${failure.message}`, ['make the call again']);

export const admission = (options: {
  readonly machine: MachineContext;
  readonly pool: ServedGraphs['Service'];
  readonly scratch: ScratchAreas['Service'];
  readonly origins: WorkingOrigins['Service'];
  readonly resolution: SessionResolution['Service'];
  readonly grants: GrantSigner['Service'];
  readonly devices: Devices['Service'];
  readonly places: ThreadPlaces;
  readonly catalog: OperationCatalog['Service'];
}): Admission['Service'] => {
  const identification = Context.get(options.machine, ProjectIdentification);
  const stand = standingOf(options.places);
  const authorize = authorityOf(options.places);
  const unopenedBy = (operation: string | null) => {
    const id = operation === null ? null : options.catalog.registry.named(operation);
    return id === null ? null : unopenedGraph(id, options.catalog.registry.entry(id));
  };
  const admitting = Effect.fn('invocation.admit')(
    function* (
      headers: Record<string, string | undefined>,
      request: Parameters<Admission['Service']['admit']>[1],
      unopened: GateRefusal<'not-served'> | null,
    ) {
      const startedAt = yield* Clock.currentTimeMillis;
      const device = yield* CallDevice;
      const {
        caller: requested,
        identity,
        served,
        project,
        refused,
        stood,
        checkout,
      } = yield* admitProject({ ...options, stand }, device === null ? headers : {}, request, unopened);
      const { caller, place, standing, authority } = yield* operationCaller(
        options.scratch,
        identity,
        checkout,
        project,
        options.origins,
        stood,
        authorize,
        device,
      );
      return {
        startedAt,
        requested,
        caller,
        place,
        served,
        project,
        refused,
        world: identity.world,
        standing,
        authority,
      } satisfies AdmittedCall;
    },
    Effect.provideService(ProjectIdentification, identification),
  );
  const admit: Admission['Service']['admit'] = (headers, request, operation) => admitting(headers, request, unopenedBy(operation));
  const protocol: Admission['Service']['admitProtocol'] = (call, declaration, meaning) =>
    admitCallers(declaration.performs ?? declaration.id, declaration.callers, meaning, call.caller, declaration.external === true).pipe(
      Effect.provideService(CallAuthority, call.authority),
      Effect.andThen(
        Effect.provide(admitRight(declaration.id, declaration.right, declaration.stream === false ? 'write' : 'read'), options.machine),
      ),
    );
  return Admission.of({
    admit,
    admitProtocol: protocol,
    admitFeed: Effect.fnUntraced(function* (declaration, projectId) {
      const call = yield* admitting(
        yield* ConnectionHeaders,
        {
          project: projectId === undefined ? undefined : String(projectId),
          cwd: undefined,
          branch: undefined,
          scope: undefined,
        },
        unopenedGraph(declaration.id, declaration),
      );
      yield* protocol(call, declaration, declaration.stream === false ? 'Call this live protocol.' : 'Subscribe to this live feed.');
      if (declaration.local === true && call.caller.actor.kind === 'operator' && call.caller.actor.deviceId !== undefined) {
        return yield* new GateRefusal('device-refused', `${declaration.id} serves only a process of this machine, not a paired device`, [
          'call it from this machine',
        ]);
      }
      if (declaration.admission === 'project' && (projectId === undefined || call.project === null)) {
        return yield* new GateRefusal('project-required', 'this feed needs a project', ['name its projectId']);
      }
    }),
    remote: (request, admitted, refused) =>
      Effect.matchEffect(Effect.mapError(options.devices.admit(request), unread), {
        onFailure: (refusal) => Effect.succeed(refused(refusal)),
        onSuccess: ({ device, renewed }) => Effect.provideService(admitted(renewed), CallDevice, device),
      }),
    pair: (request, code) => Effect.mapError(options.devices.pair(request, code), unread),
    carry: carrying(options.machine, options.pool),
  });
};
