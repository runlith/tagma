import { Effect, Semaphore } from 'effect';
import { Exposure, type SiteKeeping } from './contract/service/exposure.js';
import { TerminalSite } from './contract/service/sites.js';
import type { Blocked } from './contract/wire/access.js';
import { Ledger } from './store/ledger.js';

type Pointed = { readonly target: number; readonly port: number; readonly origin: string };

const unserved = (detail: string): Blocked => ({ _tag: 'blocked', problem: 'refused', detail, command: null, link: null });

export const makeTerminalSite = Effect.fnUntraced(function* ({ ready }: { readonly ready: () => boolean }) {
  const exposure = yield* Exposure;
  const ledger = yield* Ledger;
  const turns = yield* Semaphore.make(1);
  let pointed: Pointed | null = null;

  const keep: SiteKeeping = (port) =>
    Effect.mapError(ledger.keepTerminal(port), (failure) =>
      unserved(`the port ${port} of the terminal site could not be kept: ${failure.message}`),
    );

  const place = Effect.fnUntraced(function* (target: number) {
    if (!ready()) return yield* Effect.fail(unserved('access from another network is not ready on this server'));
    const standing = pointed;
    if (standing?.target === target) return standing.origin;
    const stored =
      standing?.port ??
      (yield* Effect.mapError(ledger.terminal, (failure) =>
        unserved(`the port of the terminal site could not be read: ${failure.message}`),
      ));
    const placed = yield* exposure.point({ port: stored, target }, keep);
    if (placed.state._tag === 'blocked') return yield* Effect.fail(placed.state);
    if (placed.state._tag !== 'ready' || placed.port === null)
      return yield* Effect.fail(unserved('Tailscale Serve gave the terminal site no address'));
    pointed = { target, port: placed.port, origin: placed.state.origin };
    return placed.state.origin;
  });

  return {
    site: TerminalSite.of({
      origin: Effect.fn('TerminalSite.origin')(function* (target) {
        return yield* turns.withPermit(place(target));
      }),
    }),
    forget: Effect.sync(() => {
      pointed = null;
    }),
  };
});
