import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Distribution } from '../cut/descriptor.js';
import { CHANNELS } from '../installation/contract/wire/channel.js';
import { applications } from '../mac-applications/placement.js';
import { macRelease } from '../mac-release/platform.js';

const checkout = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const product = join(checkout, 'apps', 'tagma');

export const sourceDistribution = (entries: Distribution['entries'], conditions: readonly string[]): Distribution => ({
  conditions,
  applications,
  platform: macRelease,
  roots: { checkout, server: join(product, 'server'), packages: join(checkout, 'packages'), desktop: join(product, 'desktop') },
  entries,
  client: { root: join(product, 'app'), config: null },
  brand: { assets: join(product, 'desktop', 'assets') },
  signing: { team: null, notary: 'tagma-notary' },
  plugins: [],
  feed: null,
  publisher: null,
  workshop: CHANNELS.dev,
});
