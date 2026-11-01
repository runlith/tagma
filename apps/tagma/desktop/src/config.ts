import { serverPort } from '@tagma/server/installation/contract/wire/ports';
import { CHANNEL } from './channel.js';

export const SURFACE_URL_ARGUMENT = '--tagma-surface-url=';

export function namedSurfaceUrl(argv: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  const argument = argv.find((value) => value.startsWith(SURFACE_URL_ARGUMENT))?.slice(SURFACE_URL_ARGUMENT.length);
  return argument?.trim() || env.TAGMA_SURFACE_URL?.trim() || undefined;
}

export function resolveSurfaceUrl(argv: readonly string[], env: NodeJS.ProcessEnv): URL {
  const configured = namedSurfaceUrl(argv, env);
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`The ${CHANNEL.name} surface must be served over http or https: ${configured}`);
    }
    return url;
  }

  return new URL(`http://127.0.0.1:${serverPort(CHANNEL, env)}`);
}
