import type { Channel } from './channel.js';

export type Ports = {
  readonly server: number;
  readonly artifact: number;
  readonly remote: number;
  readonly sandbox: number;
};

export const PORT_VARIABLES = {
  server: 'TAGMA_PORT',
  artifact: 'TAGMA_ARTIFACT_PORT',
  remote: 'TAGMA_REMOTE_PORT',
  sandbox: 'TAGMA_SANDBOX_PORT',
} as const satisfies { readonly [Port in keyof Ports]: string };

export const portBlock = (server: number): Ports => ({ server, artifact: server + 1, remote: server + 2, sandbox: server + 3 });

export const surfaceDevPort = (server: number): number => server - 1;

const named = (env: NodeJS.ProcessEnv, port: keyof Ports, fallback: number): number =>
  Number(env[PORT_VARIABLES[port]]?.trim() || String(fallback));

export const serverPort = (channel: Channel, env: NodeJS.ProcessEnv): number => named(env, 'server', channel.port);

export const portsOf = (channel: Channel, env: NodeJS.ProcessEnv): Ports => {
  const block = portBlock(serverPort(channel, env));
  return {
    server: block.server,
    artifact: named(env, 'artifact', block.artifact),
    remote: named(env, 'remote', block.remote),
    sandbox: named(env, 'sandbox', block.sandbox),
  };
};

export const portsEnv = (ports: Ports): Record<string, string> => ({
  [PORT_VARIABLES.server]: String(ports.server),
  [PORT_VARIABLES.artifact]: String(ports.artifact),
  [PORT_VARIABLES.remote]: String(ports.remote),
  [PORT_VARIABLES.sandbox]: String(ports.sandbox),
});
