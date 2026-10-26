import type { Capabilities } from '@runlith/audio/port/devices';

export const capabilities = (darwinRelease: string): Capabilities => {
  const [major = 0, minor = 0] = darwinRelease.split('.').map(Number);
  const taps = major > 23 || (major === 23 && minor >= 2);
  return { mic: true, system: taps, excludeSelf: taps, echoCancel: true, muteOutput: true, permissionPrompt: true };
};
