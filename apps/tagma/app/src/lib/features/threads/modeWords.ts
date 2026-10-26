import type { Component } from 'svelte';
import Eye from '@lucide/svelte/icons/eye';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import ShieldOff from '@lucide/svelte/icons/shield-off';
import type { ApprovalModeView } from '@runlith/agent/modes/ApprovalMode';
import type { ThreadMode, ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';

const ICONS: Readonly<Record<string, Component>> = { 'shield-check': ShieldCheck, eye: Eye, 'shield-off': ShieldOff };

export function approvalModes(declared: readonly ApprovalModeView[], active: string): ThreadModes {
  return {
    declared: declared.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      icon: mode.icon,
      elevated: mode.elevated ? true : undefined,
    })),
    active,
  };
}

export function modeIcon(mode: ThreadMode): Component | null {
  return mode.icon === undefined ? null : (ICONS[mode.icon] ?? null);
}

export function modeHint(mode: ThreadMode, notes: readonly string[]): string {
  return [mode.description, ...notes].join(' ');
}

export function nextMode(modes: ThreadModes): string | null {
  const at = modes.declared.findIndex((mode) => mode.id === modes.active);
  return at < 0 ? null : modes.declared[(at + 1) % modes.declared.length]!.id;
}
