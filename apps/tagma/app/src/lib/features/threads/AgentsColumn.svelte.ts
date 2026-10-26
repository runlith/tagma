import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

const HIDDEN_KEY = 'tagma.agentsColumnHidden';

export class AgentsColumn extends Service<AgentsColumn>()('AgentsColumn', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new AgentsColumn(platform.storage.local);
  }

  open = $state(true);

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.open = storage.getItem(HIDDEN_KEY) !== 'true';
  }

  toggle(): void {
    this.open = !this.open;
    this.storage.setItem(HIDDEN_KEY, String(!this.open));
  }
}
