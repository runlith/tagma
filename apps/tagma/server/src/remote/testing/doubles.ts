import { Effect, type Latch, Layer, Stream } from 'effect';
import { Exposure, type ExposureStep, type SitePlaced } from '../contract/service/exposure.js';
import type { AccessState } from '../contract/wire/access.js';
import { Ledger } from '../store/ledger.js';

const POINTED_PORT = 12_001;

const unread = () => Effect.die('the test reads this member of the ledger without giving it');

export const unreadLedger = Ledger.of({
  byId: unread,
  seen: unread,
  origin: unread(),
  settle: unread,
  terminal: unread(),
  keepTerminal: unread,
  issue: unread,
  exchange: unread,
  revoke: unread,
  list: unread,
});

export const exposedAt = (
  origin: string,
  certified: Latch.Latch,
  machine = 'test-machine',
  sandbox: () => AccessState = () => ({ _tag: 'certificate', origin: `${origin}:8443` }),
  pointed: { port: number; target: number }[] = [],
): Layer.Layer<Exposure> =>
  Layer.succeed(
    Exposure,
    Exposure.of({
      expose: () =>
        Stream.suspend(() => {
          const configured = sandbox();
          const ready: AccessState = configured._tag === 'certificate' ? { _tag: 'ready', origin: configured.origin } : configured;
          return Stream.make<ExposureStep[]>(
            { _tag: 'setting-up' },
            { _tag: 'certificate', origin },
            { _tag: 'listening', sandbox: configured },
          ).pipe(
            Stream.concat(
              Stream.fromEffect(Effect.as(certified.await, { _tag: 'ready', origin, sandbox: ready, machine } satisfies ExposureStep)),
            ),
          );
        }),
      point: ({ port, target }, keep) =>
        Effect.suspend(() => {
          const placed = port ?? POINTED_PORT;
          pointed.push({ port: placed, target });
          return Effect.match(placed === port ? Effect.void : keep(placed), {
            onFailure: (refused): SitePlaced => ({ port: placed, state: refused }),
            onSuccess: (): SitePlaced => ({ port: placed, state: { _tag: 'ready', origin: `${origin}:${placed}` } }),
          });
        }),
      withdraw: () => Effect.void,
    }),
  );
