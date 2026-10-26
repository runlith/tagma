import type { HostInput, HostOs } from '@runlith/layer/Host';
import { mobileShell, type ShellChoice } from '$lib/features/shell/shell.js';
import { browserOs, type BrowserPlatform } from './hostOs.js';

export function hostOf(
  desktop: HostOs | undefined,
  browser: BrowserPlatform | undefined,
  shell: ShellChoice,
  touch: boolean,
  installed: boolean,
): HostInput {
  if (desktop !== undefined) return { kind: 'desktop', os: desktop, touch, installed };
  return { kind: mobileShell(shell, touch) ? 'mobile' : 'tab', os: browserOs(browser), touch, installed };
}
