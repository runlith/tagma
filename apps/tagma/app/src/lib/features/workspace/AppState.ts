import type { PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

export interface AppStateStorage extends PlatformStorage {
  readonly ready: boolean;
  whenReady(act: () => void): void;
}

export class AppState extends Service<AppStateStorage>()('AppState', { tier: 'app' }) {}
