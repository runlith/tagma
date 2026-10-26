import type { HostOs } from '@runlith/layer/Host';

export interface BrowserPlatform {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

export function browserOs(browser: BrowserPlatform | undefined): HostOs {
  const text = (browser?.userAgentData?.platform ?? browser?.platform ?? '').toLowerCase();
  if (text.includes('iphone') || text.includes('ipad') || text.includes('ipod')) return 'ios';
  if (text.includes('mac') || text.includes('darwin')) return (browser?.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos';
  if (text.includes('win')) return 'windows';
  if (text.includes('linux') || text.includes('android') || text.includes('cros') || text.includes('x11') || text.includes('chrom')) {
    return 'linux';
  }
  return 'unknown';
}
