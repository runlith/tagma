import type { Component } from 'svelte';
import type { SurfaceMark } from '$lib/features/workspace/surface.js';

const LAUNCH = 'plugin.';

export const launchPlaceId = (plugin: string, view: string): string => `${LAUNCH}${plugin}.${view}`;

export type PlaceReach = { readonly href: string } | { readonly open: () => void };

export type RailPlace = {
  readonly id: string;
  readonly label: string;
  readonly icon: Component<{ class?: string }>;
  readonly iconUrl?: string;
  readonly mark?: SurfaceMark;
  readonly current: boolean;
  readonly reach: PlaceReach;
};
