import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

const OPEN_KEY = 'tagma.pluginsColumn';

export class PluginsColumn extends Service<PluginsColumn>()('PluginsColumn', { tier: 'app' }) {
  static *make() {
    return new PluginsColumn((yield* Platform).storage.local);
  }

  open = $state(true);

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.open = storage.getItem(OPEN_KEY) !== 'false';
  }

  toggle(): void {
    this.open = !this.open;
    this.storage.setItem(OPEN_KEY, String(this.open));
  }
}
