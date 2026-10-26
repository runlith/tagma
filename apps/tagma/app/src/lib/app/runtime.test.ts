import { expect, test } from 'vitest';
import { hostOf } from './host.js';

test('a tab answers the browser platform, the bridge wins, unknown stays unknown', () => {
  expect(hostOf(undefined, { userAgentData: { platform: 'macOS' } }, 'automatic', false, false).os).toBe('macos');
  expect(hostOf(undefined, { platform: 'MacIntel' }, 'automatic', false, false).os).toBe('macos');
  expect(hostOf(undefined, { userAgentData: { platform: 'Unknown' }, platform: '' }, 'automatic', false, false).os).toBe('unknown');
  expect(hostOf('windows', { userAgentData: { platform: 'macOS' } }, 'automatic', false, false).os).toBe('windows');
});

test('an iPhone, and an iPad that names itself a Mac with a touch screen, answer ios', () => {
  expect(hostOf(undefined, { platform: 'iPhone' }, 'automatic', false, false).os).toBe('ios');
  expect(hostOf(undefined, { platform: 'MacIntel', maxTouchPoints: 5 }, 'automatic', false, false).os).toBe('ios');
});

test('the shell follows the saved choice, else the touch screen, and the desktop app is always desktop', () => {
  const browser = { platform: 'iPhone' };
  expect(hostOf(undefined, browser, 'automatic', true, false).kind).toBe('mobile');
  expect(hostOf(undefined, browser, 'automatic', false, false).kind).toBe('tab');
  expect(hostOf(undefined, browser, 'desktop', true, false).kind).toBe('tab');
  expect(hostOf(undefined, browser, 'mobile', false, false).kind).toBe('mobile');
  expect(hostOf('macos', browser, 'mobile', true, false).kind).toBe('desktop');
});
