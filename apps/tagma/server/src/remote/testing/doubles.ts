import { Effect, type Latch, Layer, Stream } from 'effect';
import { Exposure, type ExposureStep, type SitePlaced } from '../contract/service/exposure.js';
import type { AccessState } from '../contract/wire/access.js';
import { Ledger } from '../store/ledger.js';

const SITE_PORT = 11_001;

const unread = () => Effect.die('the test reads this member of the ledger without giving it');

export const unreadLedger = Ledger.of({
  byId: unread,
  seen: unread,
  origin: unread(),
  settle: unread,
  sites: unread(),
  keepSite: unread,
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
  site: (at: string) => AccessState = (at) => ({ _tag: 'ready', origin: at }),
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
      place: (asked, reserved, keep) =>
        Stream.suspend(() => {
          const taken = new Set([...reserved, ...asked.flatMap(({ port }) => (port === null ? [] : [port]))]);
          return Stream.mapEffect(Stream.fromIterable(asked), ({ name, port }) => {
            let placed = port ?? SITE_PORT;
            while (port === null && taken.has(placed)) placed += 1;
            taken.add(placed);
            return Effect.match(placed === port ? Effect.void : keep(name, placed), {
              onFailure: (refused): SitePlaced => ({ name, port: placed, state: refused }),
              onSuccess: (): SitePlaced => ({ name, port: placed, state: site(`${origin}:${placed}`) }),
            });
          });
        }),
      withdraw: () => Effect.void,
    }),
  );
