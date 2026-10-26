import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

const ARCHIVED_THREADS_KEY = 'tagma.archivedThreadsOpen';

export class ArchivedThreadsOpen extends Service<ArchivedThreadsOpen>()('ArchivedThreadsOpen', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new ArchivedThreadsOpen(platform.storage.local);
  }

  open = $state(false);

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.open = storage.getItem(ARCHIVED_THREADS_KEY) === 'true';
  }

  toggle(): void {
    this.open = !this.open;
    this.storage.setItem(ARCHIVED_THREADS_KEY, String(this.open));
  }
}
