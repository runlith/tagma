import { deepseekRegistrations } from '@runlith/adapter-deepseek/profiles/deepseek';
import { defineAdapter } from '@runlith/tagma/adapter/provider';

export const adapter = defineAdapter(({ product }) =>
  deepseekRegistrations(product).map((registration) => ({ ...registration, kind: 'wire' as const })),
);
