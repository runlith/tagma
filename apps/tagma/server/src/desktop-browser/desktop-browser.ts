import { Context } from 'effect';
import { HOST_ADAPTERS } from '../browser/contract/service/hosts.js';
import { refusingStream } from '../platform/contract/service/body.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { desktopAdapter } from './adapter.js';
import { DesktopChannel } from './contract/service/channel.js';
import { ATTACH_FEED } from './contract/wire/channel.js';

export const desktopBrowser = manifest({
  id: 'desktop-browser',
  title: 'Tagma desktop browser host',
  contributions: HOST_ADAPTERS.of(desktopAdapter),
  live: liveOf([ATTACH_FEED] as const, (door: Context.Context<DesktopChannel>) => ({
    attach_browser_host: ({ host, pid }: { readonly host: string; readonly pid: number }) =>
      refusingStream(Context.get(door, DesktopChannel).attach(host, pid)),
  })),
  lifetimes: {
    installation: lazyLayer(
      () => import('./channel.js'),
      ({ desktopChannelLayer }) => desktopChannelLayer,
    ),
  },
});
