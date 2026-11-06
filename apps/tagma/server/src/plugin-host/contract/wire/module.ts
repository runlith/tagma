import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const pluginHost = {
  id: 'plugin-host',
  title: 'Plugin host',
} as const satisfies WireModule;
