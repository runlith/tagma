import { opencodeGoRegistrations } from '@runlith/adapter-opencode-go/profiles/opencodeGo';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { icon } from './icon';

export const adapter = defineAdapter(({ product }) =>
  opencodeGoRegistrations(product).map((registration) => ({
    ...registration,
    kind: 'wire' as const,
    icon,
    keyHint: 'Paste an API key from the OpenCode console. Each key is a separate Go subscription with its own limits.',
  })),
);
