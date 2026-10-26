import type { DesktopBrowser as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';
import { DesktopBrowser } from '$lib/shared/desktop/DesktopBrowser.js';

export class DesktopPages extends Service<DesktopPages>()('DesktopPages', { tier: 'app' }) {
  static *make() {
    return new DesktopPages((yield* DesktopBrowser.optional()) ?? null);
  }

  host = $state<string | null>(null);

  known = $state(false);

  constructor(readonly bridge: Bridge | null) {
    super();
    if (bridge === null) {
      this.known = true;
      return;
    }
    void bridge.host().then(
      (host) => {
        this.host = host;
        this.known = true;
      },
      (error: unknown) => {
        console.error('[tagma] the desktop browser bridge did not name its host', error);
        this.known = true;
      },
    );
  }
}
