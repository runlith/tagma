import { anthropicConsoleRegistrations } from '@runlith/adapter-anthropic/profiles/anthropic';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { claudeCode } from './harness/claudeCode';
import { icon } from './icon';

export const adapter = defineAdapter(({ product }) => [
  ...anthropicConsoleRegistrations(product).map((registration) => ({ ...registration, kind: 'wire' as const, icon })),
  claudeCode,
]);
