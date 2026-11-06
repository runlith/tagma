import { expect } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, Layer, Stream } from 'effect';
import { Exposure } from '../contract/service/exposure.js';
import { tailscaleExposure } from './serve.js';

const HOST = 'test.tail0000.ts.net';
const PORT = 5710;
const SANDBOX = 5711;
const target = (port: number) => `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), 'remote-exposure-'));
const configPath = join(home, 'config.json');
const origins: string[] = [];

const script = `#!${process.execPath}
const path = ${JSON.stringify(configPath)};
const host = ${JSON.stringify(HOST)};
const args = process.argv.slice(2);
const config = await Bun.file(path).json();
if (args[0] === 'status') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: host }, CertDomains: [host] }));
else if (args[1] === 'status') console.log(JSON.stringify(config));
else {
  const port = args.find((arg) => arg.startsWith('--https=')).slice(8);
  const site = host + ':' + port;
  if (args.at(-1) !== 'off' && config.Refused === port) {
    console.error('the mapping was refused');
    process.exit(1);
  }
  if (args.at(-1) === 'off') {
    delete config.TCP[port];
    delete config.Web[site];
  } else {
    config.TCP[port] = {};
    config.Web[site] = { Handlers: { '/': { Proxy: args.at(-1) } } };
  }
  await Bun.write(path, JSON.stringify(config));
}
`;

const fakeTailscale = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const path = process.env.PATH;
      const fetch = globalThis.fetch;
      writeFileSync(join(home, 'tailscale'), script);
      chmodSync(join(home, 'tailscale'), 0o755);
      process.env.PATH = `${home}:${path ?? ''}`;
      expect(Bun.which('tailscale', { PATH: process.env.PATH })).toBe(join(home, 'tailscale'));
      globalThis.fetch = Object.assign(
        async (input: string | URL | Request) => {
          origins.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          return new Response('', { status: 401 });
        },
        { preconnect: fetch.preconnect },
      );
      return { path, fetch };
    }),
    (replaced) =>
      Effect.sync(() => {
        process.env.PATH = replaced.path;
        globalThis.fetch = replaced.fetch;
        rmSync(home, { recursive: true, force: true });
      }),
  ),
);

const mapping = (port: number, proxy: string) => ({
  TCP: { [String(port)]: {} },
  Web: { [`${HOST}:${port}`]: { Handlers: { '/': { Proxy: proxy } } } },
});

const given = (config: object) => writeFileSync(configPath, JSON.stringify(config));

const served = (): { TCP: Record<string, unknown>; Web: Record<string, { Handlers: Record<string, { Proxy: string }> }> } =>
  JSON.parse(readFileSync(configPath, 'utf8'));

const expose = (settled: string | null = null) => Effect.flatMap(Exposure, (exposure) => Stream.runCollect(exposure.expose(PORT, settled)));

const withdraw = Effect.flatMap(Exposure, (exposure) => exposure.withdraw(PORT, []));

layer(Layer.merge(tailscaleExposure(SANDBOX), fakeTailscale), { excludeTestServices: true })('tailscale exposure', (it) => {
  it.effect('exposure opens a distinct sandbox origin, warms both and withdraws both owned mappings', () =>
    Effect.gen(function* () {
      given({ TCP: {}, Web: {} });
      origins.length = 0;
      expect((yield* expose()).at(-1)).toMatchObject({
        _tag: 'ready',
        origin: `https://${HOST}`,
        sandbox: { _tag: 'ready', origin: `https://${HOST}:8443` },
      });
      expect(served().Web).toEqual({
        [`${HOST}:443`]: { Handlers: { '/': { Proxy: target(PORT) } } },
        [`${HOST}:8443`]: { Handlers: { '/': { Proxy: target(SANDBOX) } } },
      });
      expect(new Set(origins)).toEqual(new Set([`https://${HOST}/health`, `https://${HOST}:8443/health`]));
      yield* withdraw;
      expect(served()).toEqual({ TCP: {}, Web: {} });
    }),
  );

  it.effect('a settled main origin stays ready while a taken or Funnel sandbox is refused without replacing it', () =>
    Effect.gen(function* () {
      given(mapping(8443, target(PORT)));
      expect((yield* expose(`https://${HOST}:8443`)).at(-1)).toMatchObject({
        _tag: 'ready',
        origin: `https://${HOST}:8443`,
        sandbox: { _tag: 'ready', origin: `https://${HOST}` },
      });
      const foreign = {
        TCP: { 443: {}, 8443: {} },
        Web: { ...mapping(443, target(PORT)).Web, ...mapping(8443, target(9999)).Web },
      };
      given(foreign);
      expect((yield* expose(`https://${HOST}`)).at(-1)).toMatchObject({
        _tag: 'ready',
        origin: `https://${HOST}`,
        sandbox: { _tag: 'blocked', problem: 'origin-taken', command: null },
      });
      expect(served()).toEqual(foreign);
      const funnel = {
        ...foreign,
        Web: { ...mapping(443, target(PORT)).Web, ...mapping(8443, target(SANDBOX)).Web },
        AllowFunnel: { [`${HOST}:8443`]: true },
      };
      given(funnel);
      expect((yield* expose(`https://${HOST}`)).at(-1)).toMatchObject({
        _tag: 'ready',
        origin: `https://${HOST}`,
        sandbox: { _tag: 'blocked', problem: 'funnel-on' },
      });
      expect(served()).toEqual(funnel);
    }),
  );

  it.effect('a refused sandbox publishes the main origin first, so the partial setup remains withdrawable', () =>
    Effect.gen(function* () {
      given({ TCP: {}, Web: {}, Refused: '8443' });
      expect(yield* expose()).toMatchObject([
        { _tag: 'setting-up' },
        { _tag: 'certificate', origin: `https://${HOST}` },
        { _tag: 'listening', sandbox: { _tag: 'blocked', problem: 'refused' } },
        { _tag: 'ready', origin: `https://${HOST}`, sandbox: { _tag: 'blocked', problem: 'refused' } },
      ]);
      expect(served().Web).toEqual(mapping(443, target(PORT)).Web);
      yield* withdraw;
      expect(served().Web).toEqual({});
    }),
  );

  it.effect('a pointed site keeps its HTTPS port while its loopback target moves, and withdrawal takes it only when named', () =>
    Effect.gen(function* () {
      given({ TCP: {}, Web: {} });
      const kept: number[] = [];
      const keep = (port: number) =>
        Effect.sync(() => {
          kept.push(port);
        });
      const exposure = yield* Exposure;
      const first = yield* exposure.point({ port: null, target: 6001 }, keep);
      expect(first).toEqual({ port: 12_001, state: { _tag: 'ready', origin: `https://${HOST}:12001` } });
      expect(kept).toEqual([12_001]);
      expect(served().Web[`${HOST}:12001`]).toEqual({ Handlers: { '/': { Proxy: target(6001) } } });
      const moved = yield* exposure.point({ port: 12_001, target: 6002 }, keep);
      expect(moved.port).toBe(12_001);
      expect(kept).toHaveLength(1);
      expect(served().Web[`${HOST}:12001`]).toEqual({ Handlers: { '/': { Proxy: target(6002) } } });
      yield* withdraw;
      expect(served().Web[`${HOST}:12001`]).toEqual({ Handlers: { '/': { Proxy: target(6002) } } });
      yield* Effect.flatMap(Exposure, (standing) => standing.withdraw(PORT, [12_001]));
      expect(served().Web).toEqual({});
    }),
  );

  it.effect('withdrawal leaves a foreign mapping and foreground mappings standing', () =>
    Effect.gen(function* () {
      const standing = { ...mapping(443, target(9999)), Foreground: { session: mapping(8443, target(SANDBOX)) } };
      given(standing);
      yield* withdraw;
      expect(served()).toEqual(standing);
    }),
  );
});
