import { Layer } from '@runlith/layer/Layer';
import { Service } from '@runlith/layer/key';
import { VIDEO_FILE } from '@tagma/server/artifacts/contract/wire/artifacts';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const ARTIFACT = /^\/a\/[^/?#]+(?:\/v\/[^/?#]+(?:\/([^/?#]+))?)?(?:[?#].*)?$/u;

export type DoorFacts = { readonly artifactOrigin: string; readonly sandboxOrigin: string | null };

export const onLoopback = (hostname: string): boolean => LOOPBACK.has(hostname);

export function artifactPath(href: string, origin: string): string | null {
  if (!href.startsWith(`${origin}/`)) return null;
  const path = href.slice(origin.length);
  const form = ARTIFACT.exec(path);
  if (form === null) return null;
  const file = form[1];
  return file === undefined || VIDEO_FILE.test(file) ? path : null;
}

const bare = (origin: string): string => origin.replace(/\/+$/u, '');

export class ServerOrigin extends Service<ServerOrigin>()('ServerOrigin', { tier: 'app' }) {
  static of(page: string) {
    return Layer.of(ServerOrigin, new ServerOrigin(page));
  }

  readonly http: string;
  readonly local: boolean;
  artifacts = $state<string | null>(null);
  sandbox = $state<string | null>(null);

  constructor(page: string) {
    super();
    const url = new URL(page);
    this.http = url.origin;
    this.local = onLoopback(url.hostname);
  }

  socket(path: string): string {
    const url = new URL(path, this.http);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  declare(facts: DoorFacts): void {
    this.artifacts = bare(facts.artifactOrigin);
    this.sandbox = facts.sandboxOrigin === null ? null : bare(facts.sandboxOrigin);
  }

  artifact(href: string): string | null {
    const path = this.artifacts === null ? null : artifactPath(href, this.artifacts);
    if (path === null) return null;
    return this.local ? href : path;
  }
}
