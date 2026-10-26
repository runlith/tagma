import { Effect, Layer, Semaphore, Stream } from 'effect';
import { Exposure, type ExposureStep, type SiteAsk, type SiteKeeping, type SitePlaced } from '../contract/service/exposure.js';
import type { AccessState, Blocked } from '../contract/wire/access.js';
import { DNS_SETTINGS_LINK, DOWNLOAD_LINK, blocked, serveCommand, serveRefusal } from './blocks.js';
import { locateCli, runCli, succeeded } from './cli.js';
import {
  HTTPS_PORTS,
  SITE_PORTS,
  holderOf,
  originOf,
  sandboxPort,
  serveArgs,
  sessionsOf,
  settledPort,
  targetOf,
  type Holder,
  type HttpsPort,
} from './mapping.js';
import { certificatesAvailable, hostOf, machineOf, readServeConfig, readStatus, type ServeConfig } from './tailnet.js';
import { originAnswers } from './warmup.js';
import { withdraw } from './withdrawal.js';

const SERVE_DEADLINE_MS = 30_000;

type Standing = {
  readonly origin: string;
  readonly machine: string;
  readonly sandboxOrigin: string;
  readonly binary: string;
  readonly proxy: Place | Blocked;
  readonly proxyTarget: string;
};

type Place = { readonly httpsPort: HttpsPort; readonly holder: Holder };

type Chosen = {
  readonly name: string;
  readonly port: number;
  readonly origin: string;
  readonly mapped: boolean;
  readonly moved: boolean;
};

type Configure = (port: number) => Effect.Effect<void, Blocked>;

type Plan = { readonly unplaced: readonly SitePlaced[]; readonly chosen: readonly Chosen[]; readonly configure: Configure };

const located = Effect.gen(function* () {
  const binary = yield* locateCli;
  if (binary === null) {
    return yield* Effect.fail(blocked('not-installed', 'Tailscale is not installed on this machine.', { link: DOWNLOAD_LINK }));
  }
  return binary;
});

const NO_DNS_NAME = blocked('refused', 'Tailscale reports no DNS name for this machine.');

const startServe = Effect.fn('tailscale.serve')(function* (binary: string, httpsPort: number, target: string) {
  const run = yield* runCli(binary, serveArgs(httpsPort, target), SERVE_DEADLINE_MS).pipe(
    Effect.mapError((failed) => blocked('refused', failed.reason)),
  );
  if (!succeeded(run)) return yield* Effect.fail(serveRefusal(run, SERVE_DEADLINE_MS));
});

const placeOf = (config: ServeConfig, host: string, target: string, settled: string | null): Place | Blocked => {
  const kept = settledPort(settled, host);
  const sessions = sessionsOf(config);
  const places = (kept === null ? HTTPS_PORTS : [kept]).map((httpsPort) => ({
    httpsPort,
    holder: holderOf(sessions, host, httpsPort, target),
  }));
  const chosen = places.find(({ holder }) => holder._tag === 'tagma') ?? places.find(({ holder }) => holder._tag === 'free');
  if (chosen === undefined) {
    if (kept === null) {
      return blocked('port-taken', `HTTPS ports ${HTTPS_PORTS.join(' and ')} on ${host} already serve other mappings.`);
    }
    const [taken] = places;
    const serves = taken?.holder._tag === 'other' ? taken.holder.serves : null;
    return blocked('origin-taken', `${originOf(host, kept)} now serves ${serves ?? 'another mapping'}.`);
  }
  if (chosen.holder._tag === 'tagma' && chosen.holder.funnel) {
    return blocked('funnel-on', `Tailscale Funnel opens ${originOf(host, chosen.httpsPort)} to the internet.`, {
      command: serveCommand(chosen.httpsPort, target),
    });
  }
  return chosen;
};

const arrange = Effect.fnUntraced(function* (port: number, proxyPort: number, settled: string | null): Effect.fn.Return<Standing, Blocked> {
  const binary = yield* located;
  const status = yield* readStatus(binary);
  if (status.BackendState !== 'Running') {
    return yield* Effect.fail(blocked('signed-out', `Tailscale is ${status.BackendState}, not Running.`));
  }
  const host = hostOf(status);
  if (host === null) return yield* Effect.fail(NO_DNS_NAME);
  if (!certificatesAvailable(status)) {
    return yield* Effect.fail(blocked('https-off', 'HTTPS certificates are not enabled for this tailnet.', { link: DNS_SETTINGS_LINK }));
  }
  const target = targetOf(port);
  const config = yield* readServeConfig(binary);
  const place = placeOf(config, host, target, settled);
  if ('_tag' in place) return yield* Effect.fail(place);
  const origin = originOf(host, place.httpsPort);
  const sandboxOrigin = originOf(host, sandboxPort(place.httpsPort));
  const proxyTarget = targetOf(proxyPort);
  const proxy = placeOf(config, host, proxyTarget, sandboxOrigin);
  if (place.holder._tag === 'free') yield* startServe(binary, place.httpsPort, target);
  return { origin, machine: machineOf(host), sandboxOrigin, binary, proxy, proxyTarget };
});

const proxyOf = Effect.fnUntraced(function* (standing: Standing): Effect.fn.Return<AccessState> {
  const proxy = standing.proxy;
  if ('_tag' in proxy) return proxy;
  const configured = proxy.holder._tag === 'free' ? startServe(standing.binary, proxy.httpsPort, standing.proxyTarget) : Effect.void;
  return yield* Effect.match(configured, {
    onFailure: (failure): AccessState => failure,
    onSuccess: (): AccessState => ({ _tag: 'certificate', origin: standing.sandboxOrigin }),
  });
});

const warmed = Effect.fnUntraced(function* (standing: Standing, configured: AccessState): Effect.fn.Return<ExposureStep> {
  if (!(yield* originAnswers(standing.origin))) {
    return blocked('refused', `${standing.origin} did not answer while its certificate was being issued.`);
  }
  const sandbox: AccessState =
    configured._tag === 'certificate'
      ? (yield* originAnswers(configured.origin))
        ? { _tag: 'ready', origin: configured.origin }
        : blocked('refused', `${configured.origin} did not answer while its certificate was being issued.`)
      : configured;
  return { _tag: 'ready', origin: standing.origin, sandbox, machine: standing.machine };
});

const certified = (standing: Standing): Stream.Stream<ExposureStep> =>
  Stream.concat(
    Stream.succeed<ExposureStep>({ _tag: 'certificate', origin: standing.origin }),
    Stream.unwrap(
      Effect.map(proxyOf(standing), (sandbox) =>
        Stream.concat(Stream.succeed<ExposureStep>({ _tag: 'listening', sandbox }), Stream.fromEffect(warmed(standing, sandbox))),
      ),
    ),
  );

const expose = (port: number, proxyPort: number, settled: string | null): Stream.Stream<ExposureStep> =>
  Stream.concat(
    Stream.succeed<ExposureStep>({ _tag: 'setting-up' }),
    Stream.unwrap(
      Effect.match(arrange(port, proxyPort, settled), {
        onFailure: (refusal) => Stream.succeed<ExposureStep>(refusal),
        onSuccess: certified,
      }),
    ),
  );

const plan = Effect.fnUntraced(function* (
  proxyPort: number,
  asked: readonly SiteAsk[],
  reserved: readonly number[],
): Effect.fn.Return<Plan, Blocked> {
  const binary = yield* located;
  const host = hostOf(yield* readStatus(binary));
  if (host === null) return yield* Effect.fail(NO_DNS_NAME);
  const sessions = sessionsOf(yield* readServeConfig(binary));
  const target = targetOf(proxyPort);
  const taken = new Set([...reserved, ...asked.flatMap(({ port }) => (port === null ? [] : [port]))]);
  const unplaced: SitePlaced[] = [];
  const chosen: Chosen[] = [];
  for (const { name, port } of asked) {
    const kept = port !== null && holderOf(sessions, host, port, target)._tag !== 'other' ? port : null;
    const free =
      kept ?? SITE_PORTS.find((candidate) => !taken.has(candidate) && holderOf(sessions, host, candidate, target)._tag === 'free');
    if (free === undefined) {
      unplaced.push({
        name,
        port,
        state: blocked('port-taken', `HTTPS ports ${SITE_PORTS[0]}–${SITE_PORTS.at(-1)} on ${host} already serve other mappings.`),
      });
      continue;
    }
    taken.add(free);
    chosen.push({
      name,
      port: free,
      origin: originOf(host, free),
      mapped: holderOf(sessions, host, free, target)._tag === 'tagma',
      moved: free !== port,
    });
  }
  const writes = yield* Semaphore.make(1);
  const configure = Effect.fn('tailscale.serveSite')(function* (port: number) {
    yield* startServe(binary, port, target);
  }, writes.withPermit);
  return { unplaced, chosen, configure };
});

const served = Effect.fnUntraced(function* (configure: Configure, keep: SiteKeeping, site: Chosen): Effect.fn.Return<AccessState, Blocked> {
  if (site.moved) yield* keep(site.name, site.port);
  if (!site.mapped) yield* configure(site.port);
  if (yield* originAnswers(site.origin)) return { _tag: 'ready', origin: site.origin };
  return blocked('refused', `${site.origin} did not answer while it was being set up.`);
});

const settled = (configure: Configure, keep: SiteKeeping, site: Chosen): Effect.Effect<SitePlaced> => {
  const placed = (state: AccessState): SitePlaced => ({ name: site.name, port: site.port, state });
  return Effect.match(served(configure, keep, site), { onFailure: placed, onSuccess: placed });
};

const placeSites = (
  proxyPort: number,
  asked: readonly SiteAsk[],
  reserved: readonly number[],
  keep: SiteKeeping,
): Stream.Stream<SitePlaced> =>
  Stream.unwrap(
    Effect.match(plan(proxyPort, asked, reserved), {
      onFailure: (refusal) => Stream.fromIterable(asked.map(({ name, port }): SitePlaced => ({ name, port, state: refusal }))),
      onSuccess: ({ unplaced, chosen, configure }) =>
        Stream.concat(
          Stream.fromIterable(unplaced),
          Stream.mapEffect(Stream.fromIterable(chosen), (site) => settled(configure, keep, site), {
            concurrency: 'unbounded',
            unordered: true,
          }),
        ),
    }),
  );

export const tailscaleExposure = (proxyPort: number): Layer.Layer<Exposure> =>
  Layer.succeed(
    Exposure,
    Exposure.of({
      expose: (port, settled) => expose(port, proxyPort, settled),
      place: (asked, reserved, keep) => placeSites(proxyPort, asked, reserved, keep),
      withdraw: (port) => withdraw([port, proxyPort]),
    }),
  );
