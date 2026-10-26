import { Clock, Effect } from 'effect';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolLinks } from './links.js';

export class ProtocolBeat {
  private before = 0;

  constructor(
    private readonly links: ProtocolLinks,
    private readonly store: HarnessSessionStore,
    private readonly ownerId: string,
  ) {}

  readonly tick = Effect.fnUntraced(function* (this: ProtocolBeat) {
    const { links, store, ownerId } = this;
    const at = yield* Clock.currentTimeMillis;
    const active = links.all().filter((link) => link.activeAt > this.before);
    const kept = new Set(
      yield* store.beat(
        ownerId,
        'acp',
        active.map((link) => link.threadId),
      ),
    );
    this.before = at;
    return links
      .all()
      .map((link) => link.threadId)
      .filter((threadId) => !kept.has(threadId));
  });
}
