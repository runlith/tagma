import { Service } from '@runlith/layer/key';
import type { Component } from 'svelte';

interface ThreadSeatPort {
  readonly Seat: Component<{ readonly id: string }>;
}

export class ViewThreads extends Service<ThreadSeatPort>()('ViewThreads', { tier: 'app' }) {}
