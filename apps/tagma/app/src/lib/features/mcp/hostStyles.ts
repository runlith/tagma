import type { ViewParams } from './ViewBridge.js';

const TOKENS: Readonly<Record<string, string>> = {
  '--color-background-primary': '--background',
  '--color-background-secondary': '--chrome',
  '--color-background-tertiary': '--sunken',
  '--color-background-inverse': '--foreground',
  '--color-background-danger': '--hover-danger',
  '--color-background-disabled': '--muted',
  '--color-text-primary': '--foreground',
  '--color-text-secondary': '--muted-foreground',
  '--color-text-tertiary': '--muted-foreground',
  '--color-text-inverse': '--background',
  '--color-text-ghost': '--muted-foreground',
  '--color-text-info': '--status-open',
  '--color-text-danger': '--destructive',
  '--color-text-success': '--status-done',
  '--color-text-warning': '--status-in-work',
  '--color-text-disabled': '--muted-foreground',
  '--color-border-primary': '--border',
  '--color-border-secondary': '--vein',
  '--color-border-tertiary': '--vein',
  '--color-border-inverse': '--foreground',
  '--color-border-info': '--status-open',
  '--color-border-danger': '--destructive',
  '--color-border-success': '--status-done',
  '--color-border-warning': '--status-in-work',
  '--color-border-disabled': '--vein',
  '--color-ring-primary': '--ring',
  '--color-ring-secondary': '--ring',
  '--color-ring-inverse': '--ring',
  '--color-ring-info': '--status-open',
  '--color-ring-danger': '--destructive',
  '--color-ring-success': '--status-done',
  '--color-ring-warning': '--status-in-work',
  '--font-sans': '--font-sans',
  '--font-mono': '--font-mono',
  '--font-text-xs-size': '--text-meta',
  '--font-text-sm-size': '--text-small',
  '--font-text-md-size': '--text-body',
  '--font-text-lg-size': '--text-page',
  '--font-text-xs-line-height': '--text-meta--line-height',
  '--font-text-sm-line-height': '--text-small--line-height',
  '--font-text-md-line-height': '--text-body--line-height',
  '--font-text-lg-line-height': '--text-page--line-height',
  '--font-heading-md-size': '--text-page',
  '--font-heading-lg-size': '--text-title',
  '--font-heading-md-line-height': '--text-page--line-height',
  '--font-heading-lg-line-height': '--text-title--line-height',
  '--border-radius-xs': '--radius-sm',
  '--border-radius-sm': '--radius-sm',
  '--border-radius-md': '--radius-md',
  '--border-radius-lg': '--radius-lg',
  '--border-radius-xl': '--radius-lg',
  '--border-radius-full': '--radius-full',
  '--shadow-sm': '--elevation-raised',
  '--shadow-md': '--elevation-raised',
  '--shadow-lg': '--elevation-float',
};

export function hostStyles(): ViewParams {
  const computed = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const [key, token] of Object.entries(TOKENS)) {
    const value = computed.getPropertyValue(token).trim();
    if (value !== '') variables[key] = value;
  }
  return { variables };
}
