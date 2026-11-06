import { Effect, Layer, Semaphore, Stream } from 'effect';
import { Exposure, type ExposureStep, type PointAsk, type SiteKeeping, type SitePlaced } from '../contract/service/exposure.js';
import type { AccessState, Blocked } from '../contract/wire/access.js';
import { DNS_SETTINGS_LINK, DOWNLOAD_LINK, blocked, serveCommand, serveRefusal } from './blocks.js';
import { locateCli, runCli, succeeded } from './cli.js';
import {
  HTTPS_PORTS,
  POINTED_PORTS,
  holderOf,
  originOf,
  pointsHome,
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

const pointed = Effect.fn('Exposure.point')(function* (
  writes: Semaphore.Semaphore,
  asked: PointAsk,
  keep: SiteKeeping,
): Effect.fn.Return<SitePlaced, Blocked> {
  const binary = yield* located;
  const host = hostOf(yield* readStatus(binary));
  if (host === null) return yield* Effect.fail(NO_DNS_NAME);
  const sessions = sessionsOf(yield* readServeConfig(binary));
  const target = targetOf(asked.target);
  const ours = (port: number) => holderOf(sessions, host, port, target)._tag !== 'other' || pointsHome(sessions, host, port);
  const port =
    asked.port !== null && ours(asked.port)
      ? asked.port
      : POINTED_PORTS.find((candidate) => holderOf(sessions, host, candidate, target)._tag === 'free');
  if (port === undefined) {
    return yield* Effect.fail(
      blocked('port-taken', `HTTPS ports ${POINTED_PORTS[0]}–${POINTED_PORTS.at(-1)} on ${host} already serve other mappings.`),
    );
  }
  const origin = originOf(host, port);
  if (port !== asked.port) yield* keep(port);
  if (holderOf(sessions, host, port, target)._tag !== 'tagma') yield* writes.withPermit(startServe(binary, port, target));
  if (!(yield* originAnswers(origin))) return yield* Effect.fail(blocked('refused', `${origin} did not answer while it was being set up.`));
  return { port, state: { _tag: 'ready', origin } };
});

export const tailscaleExposure = (proxyPort: number): Layer.Layer<Exposure> =>
  Layer.effect(
    Exposure,
    Effect.gen(function* () {
      const writes = yield* Semaphore.make(1);
      return Exposure.of({
        expose: (port, settled) => expose(port, proxyPort, settled),
        point: (asked, keep) =>
          Effect.match(pointed(writes, asked, keep), {
            onFailure: (state): SitePlaced => ({ port: asked.port, state }),
            onSuccess: (placed) => placed,
          }),
        withdraw: (port, sites) => withdraw([port, proxyPort], sites),
      });
    }),
  );
