import { Effect, Schema } from 'effect';
import type { Blocked } from '../contract/wire/access.js';
import { blocked } from './blocks.js';
import { failureOf, runCli, succeeded } from './cli.js';

const Status = Schema.Struct({
  BackendState: Schema.String,
  Self: Schema.optional(Schema.NullOr(Schema.Struct({ DNSName: Schema.optional(Schema.NullOr(Schema.String)) }))),
  CertDomains: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
export type Status = typeof Status.Type;

const Text = Schema.optional(Schema.NullOr(Schema.String));

const Handler = Schema.Struct({ Proxy: Text, Path: Text, Text });

const Site = Schema.Struct({
  Handlers: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Handler))),
});

const Served = {
  TCP: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Struct({ TCPForward: Text })))),
  Web: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Site))),
  AllowFunnel: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Boolean))),
};

const Session = Schema.Struct(Served);
export type Session = typeof Session.Type;

const ServeConfig = Schema.Struct({ ...Served, Foreground: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Session))) });
export type ServeConfig = typeof ServeConfig.Type;

const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(Status));
const decodeServeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(ServeConfig));

export const hostOf = (status: Status): string | null => {
  const name = status.Self?.DNSName?.replace(/\.$/u, '') ?? '';
  return name.length === 0 ? null : name;
};

export const machineOf = (host: string): string => host.split('.')[0] ?? host;

export const certificatesAvailable = (status: Status): boolean => (status.CertDomains ?? []).length > 0;

const readJson = <A>(
  binary: string,
  args: readonly string[],
  what: string,
  decode: (text: string) => Effect.Effect<A, unknown>,
): Effect.Effect<A, Blocked> =>
  runCli(binary, args).pipe(
    Effect.mapError((failed) => blocked('refused', `${what}: ${failed.reason}`)),
    Effect.flatMap((run) =>
      succeeded(run)
        ? decode(run.stdout).pipe(Effect.mapError(() => blocked('refused', `${what}: ${failureOf(run)}`)))
        : Effect.fail(blocked('refused', `${what}: ${failureOf(run)}`)),
    ),
  );

export const readStatus = Effect.fn('tailscale.status')(function* (binary: string) {
  return yield* readJson(binary, ['status', '--json', '--peers=false'], 'Tailscale status could not be read', decodeStatus);
});

export const readServeConfig = Effect.fn('tailscale.serveStatus')(function* (binary: string) {
  return yield* readJson(binary, ['serve', 'status', '--json'], 'Tailscale Serve status could not be read', decodeServeConfig);
});
