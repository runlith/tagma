import type { Component } from 'svelte';

export type PlaceReach = { readonly href: string } | { readonly open: () => void };

export type RailPlace = {
  readonly id: string;
  readonly label: string;
  readonly icon: Component<{ class?: string }>;
  readonly iconUrl?: string;
  readonly current: boolean;
  readonly reach: PlaceReach;
};
