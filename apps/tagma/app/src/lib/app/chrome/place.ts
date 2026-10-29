import type { Component } from 'svelte';

const LAUNCH = 'app.';

const FORMER_LAUNCH = 'plugin.';

export const launchPlaceId = (tagmaApp: string, view: string): string => `${LAUNCH}${tagmaApp}.${view}`;

export const launchNamed = (stored: string): string =>
  stored.startsWith(FORMER_LAUNCH) ? `${LAUNCH}${stored.slice(FORMER_LAUNCH.length)}` : stored;

export type PlaceReach = { readonly href: string } | { readonly open: () => void };

export type RailPlace = {
  readonly id: string;
  readonly label: string;
  readonly icon: Component<{ class?: string }>;
  readonly iconUrl?: string;
  readonly current: boolean;
  readonly reach: PlaceReach;
};
