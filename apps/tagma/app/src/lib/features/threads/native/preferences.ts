import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { chatDisclosureOf, type ChatPreferences } from '@runlith/chat-ui/surface';

const VERBOSE_KEY = 'tagma.harness.verbose';
const STRETCHES_KEY = 'tagma.harness.stretches';
const DISCLOSURE_KEY = 'tagma.harness.disclosure';

function readDisclosure(storage: PlatformStorage): Record<string, Record<string, boolean>> {
  const stored = storage.getItem(DISCLOSURE_KEY);
  if (!stored) return {};
  try {
    return chatDisclosureOf(JSON.parse(stored));
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

function chatPreferences(storage: PlatformStorage): ChatPreferences {
  return {
    verbose: {
      read: () => storage.getItem(VERBOSE_KEY) === 'on',
      write: (value) => storage.setItem(VERBOSE_KEY, value ? 'on' : 'off'),
    },
    stretches: {
      read: () => (storage.getItem(STRETCHES_KEY) === 'all' ? 'all' : 'newest'),
      write: (value) => storage.setItem(STRETCHES_KEY, value),
    },
    disclosure: {
      read: () => readDisclosure(storage),
      write: (rows) => storage.setItem(DISCLOSURE_KEY, JSON.stringify(rows)),
    },
  };
}

export class ThreadPreferences extends Service<ThreadPreferences>()('ThreadPreferences', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new ThreadPreferences(platform.storage.local);
  }

  readonly surface: ChatPreferences;

  constructor(storage: PlatformStorage) {
    super();
    this.surface = chatPreferences(storage);
  }
}
