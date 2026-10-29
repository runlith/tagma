import type { MarketplaceAdded } from './settings.js';

export type MarketplacePreset = MarketplaceAdded & { readonly title: string };

export const SHIPPED_PRESETS: readonly MarketplacePreset[] = [
  {
    id: 'claude-plugins-official',
    title: 'Anthropic',
    label: 'vendor',
    source: { kind: 'git', url: 'https://github.com/anthropics/claude-plugins-official.git' },
  },
  {
    id: 'openai-curated',
    title: 'OpenAI',
    label: 'vendor',
    source: { kind: 'git', url: 'https://github.com/openai/plugins.git' },
  },
];
