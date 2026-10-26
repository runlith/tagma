import type { CommandFailure, Session } from '@runlith/cdp/session';
import { Effect } from 'effect';
import type { EmulationChange } from '../contract/service/automation.js';
import { DEVICES, type Emulation, NO_EMULATION, type Viewport } from '../contract/wire/emulation.js';

export const nextEmulation = (current: Emulation, change: EmulationChange): Emulation => {
  if (change.clear) return NO_EMULATION;
  return {
    viewport: change.device !== undefined ? null : (change.viewport ?? current.viewport),
    device: change.viewport !== undefined ? null : (change.device ?? current.device),
    scheme: change.scheme ?? current.scheme,
  };
};

export const effectiveOf = (emulation: Emulation, layout: Viewport | null): Emulation =>
  layout === null || emulation.viewport !== null || emulation.device !== null ? emulation : { ...emulation, viewport: layout };

const metricsOf = (emulation: Emulation) => {
  const device = emulation.device === null ? null : DEVICES[emulation.device];
  if (device !== null) return { width: device.width, height: device.height, deviceScaleFactor: device.scale, mobile: device.mobile };
  if (emulation.viewport === null) return null;
  return {
    width: emulation.viewport.width,
    height: emulation.viewport.height,
    deviceScaleFactor: emulation.viewport.scale ?? 0,
    mobile: emulation.viewport.mobile ?? false,
  };
};

const agentOf = (emulation: Emulation): string | null => (emulation.device === null ? null : DEVICES[emulation.device].agent);

export const applyEmulation = Effect.fnUntraced(function* (
  session: Session,
  emulation: Emulation,
  previous: Emulation = NO_EMULATION,
): Effect.fn.Return<void, CommandFailure> {
  const metrics = metricsOf(emulation);
  const before = metricsOf(previous);
  if (metrics !== null) yield* session.send('Emulation.setDeviceMetricsOverride', metrics);
  else if (before !== null) yield* session.send('Emulation.clearDeviceMetricsOverride');
  if ((metrics?.mobile ?? false) !== (before?.mobile ?? false)) {
    yield* session.send('Emulation.setTouchEmulationEnabled', { enabled: metrics?.mobile ?? false });
  }
  const agent = agentOf(emulation);
  if (agent !== null) yield* session.send('Emulation.setUserAgentOverride', { userAgent: agent });
  else if (agentOf(previous) !== null) yield* session.send('Emulation.setUserAgentOverride', { userAgent: '' });
  if (emulation.scheme !== previous.scheme) {
    yield* session.send('Emulation.setEmulatedMedia', {
      features: emulation.scheme === null ? [] : [{ name: 'prefers-color-scheme', value: emulation.scheme }],
    });
  }
});
