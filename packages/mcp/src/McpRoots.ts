import type { Root } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

export class McpRoots {
  private readonly roots = new Map<string, { readonly root: Root; readers: number }>();
  private revision = 0;
  private sent = 0;
  private closed = false;

  retain(paths: readonly string[]): { readonly release: () => void } {
    const uris = new Set(paths.map((path) => pathToFileURL(path).href));
    let changed = false;
    for (const uri of uris) {
      const held = this.roots.get(uri);
      if (held !== undefined) held.readers += 1;
      else if (!this.closed) {
        this.roots.set(uri, { root: { uri }, readers: 1 });
        changed = true;
      }
    }
    if (changed) this.revision += 1;
    let released = false;
    return {
      release: () => {
        if (released || this.closed) return;
        released = true;
        let changed = false;
        for (const uri of uris) {
          const held = this.roots.get(uri);
          if (held === undefined || --held.readers > 0) continue;
          this.roots.delete(uri);
          changed = true;
        }
        if (changed) this.revision += 1;
      },
    };
  }

  pending(): number | undefined {
    return !this.closed && this.sent < this.revision ? this.revision : undefined;
  }

  notified(revision: number): void {
    this.sent = Math.max(this.sent, revision);
  }

  answer(): { readonly roots: Root[] } {
    return { roots: [...this.roots.values()].map((held) => held.root) };
  }

  close(): void {
    this.closed = true;
    this.roots.clear();
  }
}
