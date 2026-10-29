import { Schema } from 'effect';

export type Device = {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly mobile: boolean;
  readonly agent: string | null;
};

export const DEVICES = {
  'iphone-15': {
    width: 393,
    height: 852,
    scale: 3,
    mobile: true,
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  'pixel-8': {
    width: 412,
    height: 915,
    scale: 2.625,
    mobile: true,
    agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  },
  ipad: {
    width: 820,
    height: 1180,
    scale: 2,
    mobile: true,
    agent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  laptop: { width: 1440, height: 900, scale: 2, mobile: false, agent: null },
} as const satisfies Readonly<Record<string, Device>>;

export type DeviceName = keyof typeof DEVICES;

export const DEVICE_NAMES = Object.keys(DEVICES) as readonly DeviceName[];

export const SCHEMES = ['light', 'dark'] as const;

export const Viewport = Schema.Struct({
  width: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 4000 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 4000 })),
  scale: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 4 }))),
  mobile: Schema.optional(Schema.Boolean),
});
export type Viewport = typeof Viewport.Type;

export const Network = Schema.Struct({
  latency: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description: 'Added latency in milliseconds.' }),
  download: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(-1)).annotate({
    description: 'Download throughput in bytes per second; -1 leaves it unlimited.',
  }),
  upload: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(-1)).annotate({
    description: 'Upload throughput in bytes per second; -1 leaves it unlimited.',
  }),
});
export type Network = typeof Network.Type;

export const NETWORKS = {
  offline: { latency: 0, download: 0, upload: 0 },
  'slow-3g': { latency: 400 * 5, download: ((500 * 1000) / 8) * 0.8, upload: ((500 * 1000) / 8) * 0.8 },
  'fast-3g': { latency: 150 * 3.75, download: ((1.6 * 1000 * 1000) / 8) * 0.9, upload: ((750 * 1000) / 8) * 0.9 },
  'slow-4g': { latency: 150 * 3.75, download: ((1.6 * 1000 * 1000) / 8) * 0.9, upload: ((750 * 1000) / 8) * 0.9 },
  'fast-4g': { latency: 60 * 2.75, download: ((9 * 1000 * 1000) / 8) * 0.9, upload: ((1.5 * 1000 * 1000) / 8) * 0.9 },
} as const satisfies Readonly<Record<string, Network>>;
export type NetworkName = keyof typeof NETWORKS;
export const NETWORK_NAMES = Object.keys(NETWORKS) as readonly NetworkName[];
export const NetworkCondition = Schema.Union([Schema.Literals(NETWORK_NAMES), Network]);
export type NetworkCondition = typeof NetworkCondition.Type;
export const networkOf = (condition: NetworkCondition): Network => (typeof condition === 'string' ? NETWORKS[condition] : condition);

export const Geolocation = Schema.Struct({
  latitude: Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  longitude: Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  accuracy: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type Geolocation = typeof Geolocation.Type;

export const Cpu = Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 20 }));
export const Conditions = Schema.Struct({
  cpu: Cpu,
  network: Schema.NullOr(NetworkCondition),
  geolocation: Schema.NullOr(Geolocation),
});
export type Conditions = typeof Conditions.Type;
export const NO_CONDITIONS: Conditions = { cpu: 1, network: null, geolocation: null };
export const conditionsOf = (conditions: Conditions): string | null => {
  const parts: string[] = [];
  if (conditions.cpu !== 1) parts.push(`cpu ${conditions.cpu}×`);
  if (conditions.network !== null) {
    const network = conditions.network;
    parts.push(
      typeof network === 'string'
        ? `network ${network}`
        : `network ${network.latency} ms, ↓${network.download === -1 ? 'unlimited' : `${network.download} B/s`}, ↑${network.upload === -1 ? 'unlimited' : `${network.upload} B/s`}`,
    );
  }
  if (conditions.geolocation !== null) {
    const location = conditions.geolocation;
    parts.push(`location ${location.latitude}, ${location.longitude}${location.accuracy === undefined ? '' : ` ±${location.accuracy} m`}`);
  }
  return parts.length === 0 ? null : parts.join(', ');
};

export const Emulation = Schema.Struct({
  viewport: Schema.NullOr(Viewport),
  device: Schema.NullOr(Schema.Literals(DEVICE_NAMES)),
  scheme: Schema.NullOr(Schema.Literals(SCHEMES)),
  ...Conditions.fields,
});
export type Emulation = typeof Emulation.Type;

export const NO_EMULATION: Emulation = { viewport: null, device: null, scheme: null, ...NO_CONDITIONS };
