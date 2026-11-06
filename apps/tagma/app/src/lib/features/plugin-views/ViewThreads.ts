import { Service } from '@runlith/layer/key';
import type { Component } from 'svelte';

interface ViewThreadsPort {
  readonly Placed: Component<{ readonly id: string }>;
}

export class ViewThreads extends Service<ViewThreadsPort>()('ViewThreads', { tier: 'app' }) {}
