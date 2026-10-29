import type { CommandFailure, Session } from '@runlith/cdp/session';
import { Effect, Exit, Scope } from 'effect';
import type { EmulationChange } from '../contract/service/automation.js';
import { hostRefusal, Pages } from '../contract/service/pages.js';
import { ThreadRuns } from '../contract/service/runs.js';
import {
  DEVICES,
  type Conditions,
  type Emulation,
  NO_CONDITIONS,
  NO_EMULATION,
  networkOf,
  type Viewport,
} from '../contract/wire/emulation.js';
import type { Strain } from '../contract/wire/host.js';
import type { Attached, Paged } from './drive.js';
import { unknownPage } from './refusal.js';
import { endsWithRun } from './lifetime.js';

export const nextEmulation = (current: Emulation, change: EmulationChange): Emulation => {
  if (change.clear) return NO_EMULATION;
  const conditions =
    change.conditions === false
      ? NO_CONDITIONS
      : {
          cpu: change.cpu ?? current.cpu,
          network: change.network === undefined ? current.network : change.network,
          geolocation: change.geolocation === undefined ? current.geolocation : change.geolocation,
        };
  return {
    viewport: change.device !== undefined ? null : (change.viewport ?? current.viewport),
    device: change.viewport !== undefined ? null : (change.device ?? current.device),
    scheme: change.scheme ?? current.scheme,
    ...conditions,
  };
};

export const effectiveOf = (emulation: Emulation, layout: Viewport | null): Emulation =>
  layout === null || emulation.viewport !== null || emulation.device !== null ? emulation : { ...emulation, viewport: layout };

const metricsOf = (emulation: Emulation) => {
  const device = emulation.device === null ? null : DEVICES[emulation.device];
  if (device !== null) return { width: device.width, height: device.height, deviceScaleFactor: device.scale, mobile: device.mobile };
  if (emulation.viewport === null) return null;
  return {
    width: emulation.viewport.width,
    height: emulation.viewport.height,
    deviceScaleFactor: emulation.viewport.scale ?? 0,
    mobile: emulation.viewport.mobile ?? false,
  };
};

const agentOf = (emulation: Emulation): string | null => (emulation.device === null ? null : DEVICES[emulation.device].agent);

export const applyConditions = Effect.fn('browser.applyConditions')(function* (
  session: Session,
  next: Conditions,
  previous: Conditions = NO_CONDITIONS,
  child?: string,
): Effect.fn.Return<void, CommandFailure> {
  if (next.cpu !== previous.cpu) yield* session.send('Emulation.setCPUThrottlingRate', { rate: next.cpu }, child);
  if (next.network !== previous.network) {
    const network = next.network === null ? null : networkOf(next.network);
    yield* session.send(
      'Network.emulateNetworkConditionsByRule',
      {
        offline: next.network === 'offline',
        matchedNetworkConditions:
          network === null
            ? []
            : [
                {
                  urlPattern: '',
                  latency: network.latency,
                  downloadThroughput: network.download,
                  uploadThroughput: network.upload,
                },
              ],
      },
      child,
    );
    if (next.network === 'offline' || previous.network === 'offline') {
      yield* session.send(
        'Network.overrideNetworkState',
        {
          offline: next.network === 'offline',
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        },
        child,
      );
    }
  }
  if (child === undefined && next.geolocation !== previous.geolocation) {
    if (next.geolocation === null) yield* session.send('Emulation.clearGeolocationOverride');
    else
      yield* session.send('Emulation.setGeolocationOverride', {
        latitude: next.geolocation.latitude,
        longitude: next.geolocation.longitude,
        accuracy: next.geolocation.accuracy ?? 0,
      });
  }
});

export const holdStrain = Effect.fnUntraced(function* (attached: Attached, strain: Strain) {
  const pages = yield* Pages;
  const host = yield* pages.hold(attached.page);
  const token = {};
  const update = () => {
    attached.strain = {
      factor: Math.max(1, ...[...attached.strains.values()].map((held) => held.factor)),
      paused: [...attached.strains.values()].some((held) => held.paused),
    };
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      attached.strains.set(token, strain);
      update();
    }),
    () =>
      Effect.sync(() => {
        attached.strains.delete(token);
        update();
      }),
  );
  yield* host.pages.strain(attached.page, strain).pipe(
    Effect.catchTags({
      PageMissing: () => Effect.fail(unknownPage(attached.page)),
      HostLost: (failure) => Effect.fail(hostRefusal(failure)),
      HostRefused: (failure) => Effect.fail(hostRefusal(failure)),
    }),
  );
});

const allConditions = (attached: Attached, next: Conditions, previous: Conditions) =>
  Effect.forEach(
    [undefined, ...attached.children.keys()],
    (child) =>
      applyConditions(attached.session, next, previous, child).pipe(
        Effect.catchTag('SessionEnded', (failure) =>
          child === undefined
            ? Effect.fail(failure)
            : Effect.logDebug(`browser: conditions skipped a detached frame of ${attached.page}: ${failure.message}`),
        ),
      ),
    { discard: true },
  );

const cleanConditions = (attached: Attached, next: Conditions, previous: Conditions) =>
  allConditions(attached, next, previous).pipe(
    Effect.catchTags({
      SessionEnded: (failure) => Effect.logDebug(`browser: conditions on page ${attached.page} ended with its session: ${failure.message}`),
      CommandRefused: (failure) =>
        Effect.logWarning(`browser: conditions on page ${attached.page} could not be restored: ${failure.message}`),
      PayloadUnreadable: (failure) =>
        Effect.logWarning(`browser: conditions on page ${attached.page} answered unreadably: ${failure.message}`),
      WorkerUnavailable: (failure) => Effect.logWarning(`browser: conditions on page ${attached.page} were not read: ${failure.message}`),
    }),
  );

export const changeConditions = Effect.fnUntraced(function* (state: Paged, attached: Attached, next: Emulation, thread: string | null) {
  const pages = yield* Pages;
  const runs = yield* ThreadRuns;
  const previous = state.emulation;
  const old = attached.conditions;
  const active = next.cpu !== 1 || next.network !== null || next.geolocation !== null;
  const held = yield* Scope.fork(attached.scope);
  yield* Effect.gen(function* () {
    if (next.cpu > 1) yield* Scope.provide(holdStrain(attached, { factor: next.cpu, paused: false }), held);
    if (next.geolocation !== null) {
      const host = yield* pages.hold(state.page);
      yield* Scope.provide(host.pages.geolocation(state.page), held).pipe(
        Effect.catchTags({
          PageMissing: () => Effect.fail(unknownPage(state.page)),
          HostLost: (failure) => Effect.fail(hostRefusal(failure)),
          HostRefused: (failure) => Effect.fail(hostRefusal(failure)),
        }),
      );
    }
    let committed = false;
    yield* Scope.addFinalizer(
      held,
      Effect.gen(function* () {
        if (!committed) return;
        state.watching -= 1;
        yield* attached.emulating.withPermits(1)(
          Effect.gen(function* () {
            if (attached.conditions !== held) return;
            yield* cleanConditions(attached, NO_CONDITIONS, state.emulation);
            state.emulation = { ...state.emulation, ...NO_CONDITIONS };
            attached.conditions = null;
            yield* pages.mark(state.page, { conditions: NO_CONDITIONS });
          }),
        );
      }),
    );
    yield* attached.emulating.withPermits(1)(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* restore(allConditions(attached, next, previous)).pipe(
            Effect.onExit((exit) => (Exit.isFailure(exit) ? cleanConditions(attached, previous, next) : Effect.void)),
          );
          state.emulation = next;
          attached.conditions = active ? held : null;
          state.watching += 1;
          committed = true;
          yield* pages.mark(state.page, { conditions: { cpu: next.cpu, network: next.network, geolocation: next.geolocation } });
        }),
      ),
    );
    if (old !== null) yield* Scope.close(old, Exit.void);
    if (thread !== null && active)
      yield* Scope.provide(endsWithRun(runs, thread, state.queue.withPermits(1)(Scope.close(held, Exit.void))), held);
    if (!active) yield* Scope.close(held, Exit.void);
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(held, Exit.void) : Effect.void)));
});

export const applyEmulation = Effect.fnUntraced(function* (
  session: Session,
  emulation: Emulation,
  previous: Emulation = NO_EMULATION,
): Effect.fn.Return<void, CommandFailure> {
  const metrics = metricsOf(emulation);
  const before = metricsOf(previous);
  if (metrics !== null) yield* session.send('Emulation.setDeviceMetricsOverride', metrics);
  else if (before !== null) yield* session.send('Emulation.clearDeviceMetricsOverride');
  if ((metrics?.mobile ?? false) !== (before?.mobile ?? false)) {
    yield* session.send('Emulation.setTouchEmulationEnabled', { enabled: metrics?.mobile ?? false });
  }
  const agent = agentOf(emulation);
  if (agent !== null) yield* session.send('Emulation.setUserAgentOverride', { userAgent: agent });
  else if (agentOf(previous) !== null) yield* session.send('Emulation.setUserAgentOverride', { userAgent: '' });
  if (emulation.scheme !== previous.scheme) {
    yield* session.send('Emulation.setEmulatedMedia', {
      features: emulation.scheme === null ? [] : [{ name: 'prefers-color-scheme', value: emulation.scheme }],
    });
  }
});
