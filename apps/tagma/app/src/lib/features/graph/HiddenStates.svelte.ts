import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { RESTING_STATES, type RestingState } from './status.js';

const HIDDEN_KEY = 'tagma.hiddenStates';

export class HiddenStates extends Service<HiddenStates>()('HiddenStates', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new HiddenStates(platform.storage.local);
  }

  hiddenStates = $state<ReadonlySet<RestingState>>(new Set(RESTING_STATES));

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.hiddenStates = read(storage);
  }

  isHidden(state: RestingState): boolean {
    return this.hiddenStates.has(state);
  }

  toggleHidden(state: RestingState): void {
    const next = new Set(this.hiddenStates);
    if (!next.delete(state)) next.add(state);
    this.hiddenStates = next;
    this.storage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  }
}

function read(storage: PlatformStorage): Set<RestingState> {
  const raw = storage.getItem(HIDDEN_KEY);
  if (!raw) return new Set(RESTING_STATES);
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return new Set(RESTING_STATES.filter((state) => list.includes(state)));
  } catch {
    return new Set(RESTING_STATES);
  }
}
