import type { Piece } from '@tagma/server/speech/contract/wire/listening';
import { Service } from '@runlith/layer/key';

export type Topic =
  | { readonly kind: 'block'; readonly name: string; readonly title: string; readonly tag: string | null }
  | { readonly kind: 'text'; readonly text: string; readonly born?: (thread: { readonly id: string; readonly projectId: number }) => void }
  | { readonly kind: 'piece'; readonly piece: Piece; readonly ask?: string };

export class Topics extends Service<Topics>()('Topics', { tier: 'app' }) {
  static make(): Topics {
    return new Topics();
  }

  private offered: (() => Topic | null)[] = [];

  offer(read: () => Topic | null): () => void {
    this.offered.push(read);
    return () => {
      this.offered = this.offered.filter((standing) => standing !== read);
    };
  }

  get current(): Topic | null {
    for (let at = this.offered.length - 1; at >= 0; at--) {
      const topic = this.offered[at]?.() ?? null;
      if (topic !== null) return topic;
    }
    return null;
  }
}
