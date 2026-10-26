import type { ApprovalMode, ModeLookup } from './ApprovalMode';

export const AGENT_MODES_OWNER = '@runlith/agent';

export const trust: ApprovalMode = {
  id: 'trust',
  label: 'Trust',
  description: 'Asks about the acts that declare trust as their rung; everything else runs.',
  icon: 'shield-check',
  strictness: 1,
};

export const review: ApprovalMode = {
  id: 'review',
  label: 'Review',
  description: 'Asks wherever trust asks, and before every call that is not a pure read.',
  icon: 'eye',
  strictness: 2,
};

export const bypass: ApprovalMode = {
  id: 'bypass',
  label: 'Bypass',
  description: 'Asks about nothing; a system limit still refuses the call.',
  icon: 'shield-off',
  elevated: true,
  confirmsWaiting: true,
  strictness: 0,
};

export const DEFAULT_MODE = trust.id;

export const BUILTIN_MODES: readonly ApprovalMode[] = [trust, review, bypass];

export const builtinModes: ModeLookup = { find: (id) => BUILTIN_MODES.find((mode) => mode.id === id) };
