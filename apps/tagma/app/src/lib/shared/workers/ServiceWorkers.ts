import { Service } from '@runlith/layer/key';
import type { Subscription } from '@tagma/server/push/contract/wire/push';

export type Permission = 'default' | 'denied' | 'granted';

export interface WorkerNotice {
  readonly tag: string;
  close(): void;
}

export interface WorkerPort {
  readonly pushable: boolean;
  register(): Promise<void>;
  unregister(): Promise<void>;
  permission(): Permission;
  askPermission(): Promise<Permission>;
  subscription(): Promise<Subscription | null>;
  subscribe(key: string): Promise<Subscription>;
  notices(tag?: string): Promise<readonly WorkerNotice[]>;
  badge(count: number): Promise<void>;
  onMessage(listener: (data: unknown) => void): () => void;
}

export class ServiceWorkers extends Service<WorkerPort>()('ServiceWorkers', { tier: 'app' }) {}
