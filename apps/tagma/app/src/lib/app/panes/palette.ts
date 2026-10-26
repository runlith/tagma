import { Overlay } from '@runlith/primitives/Overlay.svelte';

export const GROUPS = ['projects', 'files', 'threads', 'blocks', 'commits', 'settings', 'actions'] as const;

export type GroupId = (typeof GROUPS)[number];

export const Palette = Overlay.define<{ group?: GroupId; query?: string; beside?: boolean }>()('tagma/palette', { as: 'dialog' });
