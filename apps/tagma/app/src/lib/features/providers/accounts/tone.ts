import type { UsageTone } from '../usage/thresholds.js';

const TEXT: Record<UsageTone, string> = {
  plain: 'text-foreground/75',
  warning: 'text-severity-gap',
  alarm: 'text-severity-lie',
};

const FILL: Record<UsageTone, string> = {
  plain: 'var(--muted-foreground)',
  warning: 'var(--severity-gap)',
  alarm: 'var(--severity-lie)',
};

export function toneText(tone: UsageTone): string {
  return TEXT[tone];
}

export function percentInk(tone: UsageTone): string {
  return tone === 'alarm' ? TEXT.alarm : TEXT.plain;
}

export function toneFill(tone: UsageTone): string {
  return FILL[tone];
}
