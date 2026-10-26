import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

const LINKS_PLACEMENT_KEY = 'tagma.linksPlacement';

export type Placement = 'side' | 'below';

export class LinksPlacement extends Service<LinksPlacement>()('LinksPlacement', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new LinksPlacement(platform.storage.local);
  }

  placement = $state<Placement>('side');

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.placement = storage.getItem(LINKS_PLACEMENT_KEY) === 'below' ? 'below' : 'side';
  }

  toggle(): void {
    this.placement = this.placement === 'side' ? 'below' : 'side';
    this.storage.setItem(LINKS_PLACEMENT_KEY, this.placement);
  }
}
