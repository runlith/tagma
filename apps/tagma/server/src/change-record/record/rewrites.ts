import { contentDigest } from '@runlith/files/content';

type Rewrite = { readonly digest: string; readonly commit: string | null };

const KEPT = 512;

export class Rewrites {
  private readonly checkouts = new Map<string, Map<string, Rewrite>>();

  readonly rewrote = (key: string, name: string, digest: string, commit: string | null): void => {
    const known = this.checkouts.get(key) ?? new Map<string, Rewrite>();
    this.checkouts.set(key, known);
    known.delete(name);
    known.set(name, { digest, commit });
    for (const oldest of known.keys()) {
      if (known.size <= KEPT) break;
      known.delete(oldest);
    }
  };

  readonly by = (key: string, name: string, text: string): { readonly commit: string | null } | null => {
    const found = this.checkouts.get(key)?.get(name);
    return found !== undefined && found.digest === contentDigest(text) ? { commit: found.commit } : null;
  };
}
