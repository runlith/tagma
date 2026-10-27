import type { ServeConfig, Session } from './tailnet.js';

export const HTTPS_PORTS = [443, 8443] as const;
export type HttpsPort = (typeof HTTPS_PORTS)[number];

export const SITE_PORTS: readonly number[] = Array.from({ length: 999 }, (_, at) => 11_001 + at);

export const POINTED_PORTS: readonly number[] = Array.from({ length: 99 }, (_, at) => 12_001 + at);

export type Holder =
  | { readonly _tag: 'free' }
  | { readonly _tag: 'tagma'; readonly funnel: boolean }
  | { readonly _tag: 'other'; readonly serves: string | null };

export const targetOf = (port: number): string => `http://127.0.0.1:${port}`;

export const sessionsOf = (config: ServeConfig): readonly Session[] => [config, ...Object.values(config.Foreground ?? {})];

export const holderOf = (sessions: readonly Session[], host: string, httpsPort: number, target: string): Holder => {
  const site = `${host}:${httpsPort}`;
  for (const session of sessions) {
    const root = session.Web?.[site]?.Handlers?.['/'];
    if (root?.Proxy === target) return { _tag: 'tagma', funnel: session.AllowFunnel?.[site] === true };
    const held = session.TCP?.[String(httpsPort)];
    if (held !== undefined) return { _tag: 'other', serves: root?.Proxy ?? root?.Path ?? held.TCPForward ?? null };
  }
  return { _tag: 'free' };
};

const LOOPBACK_TARGET = /^http:\/\/127\.0\.0\.1:\d+$/u;

export const pointsHome = (sessions: readonly Session[], host: string, httpsPort: number): boolean => {
  const site = `${host}:${httpsPort}`;
  const proxy = sessions.find((session) => session.Web?.[site] != null)?.Web?.[site]?.Handlers?.['/']?.Proxy;
  return proxy != null && LOOPBACK_TARGET.test(proxy);
};

export const servedPorts = (session: Session, host: string): readonly number[] =>
  Object.keys(session.Web ?? {}).flatMap((site) => {
    const port = site.startsWith(`${host}:`) ? Number(site.slice(host.length + 1)) : Number.NaN;
    return Number.isInteger(port) ? [port] : [];
  });

export const sandboxPort = (httpsPort: HttpsPort): HttpsPort => (httpsPort === 443 ? 8443 : 443);

export const originOf = (host: string, httpsPort: number): string =>
  httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;

export const settledPort = (settled: string | null, host: string): HttpsPort | null =>
  HTTPS_PORTS.find((httpsPort) => originOf(host, httpsPort) === settled) ?? null;

export const serveArgs = (httpsPort: number, target: string): readonly string[] => ['serve', '--bg', `--https=${httpsPort}`, target];

export const withdrawArgs = (httpsPort: number): readonly string[] => ['serve', `--https=${httpsPort}`, '--set-path=/', 'off'];
