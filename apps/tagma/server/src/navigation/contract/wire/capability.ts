import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';
import { navigationEnabled } from './settings.js';

export const navigationCapability = {
  id: 'navigation',
  enabledBy: navigationEnabled,
  guide:
    'Before grepping for who calls, implements or passes a member, ask `uses Owner.member`: one call finds it under every receiver name; where a symbol is declared, ask `definition`.',
  cue: { tool: 'grep', input: 'pattern', matches: String.raw`\\\.(?:[\w$]+(?:\\s\*)?\\\(|\([\w$]+(?:\|[\w$]+)+\))` },
  description: 'finding where a code symbol is declared and every place it is used, with a verdict for each text occurrence of its name',
  sections: ['code-navigation'],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
