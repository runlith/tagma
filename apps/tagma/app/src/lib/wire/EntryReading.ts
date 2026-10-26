import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
import { Service } from '@runlith/layer/key';

export class EntryReading extends Service<EntryKinds>()('EntryReading', { tier: 'app' }) {}
