import { Service } from '@runlith/layer/key';

export type Origin = { readonly page: string | null; readonly frame: string | null };

export interface Runner {
  owns(action: string): boolean;
  run(action: string, origin: Origin): boolean;
}

export class ActionRunner extends Service<Runner>()('ActionRunner', { tier: 'app' }) {}
