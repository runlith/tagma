import type { WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { Point } from '@runlith/layer/Point';

export const WireCatalog = Point.define<WireModule>()('WireCatalog', {
  tier: 'app',
  key: (module) => module.id,
});
