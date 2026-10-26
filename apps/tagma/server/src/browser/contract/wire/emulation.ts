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

export const Emulation = Schema.Struct({
  viewport: Schema.NullOr(Viewport),
  device: Schema.NullOr(Schema.Literals(DEVICE_NAMES)),
  scheme: Schema.NullOr(Schema.Literals(SCHEMES)),
});
export type Emulation = typeof Emulation.Type;

export const NO_EMULATION: Emulation = { viewport: null, device: null, scheme: null };
