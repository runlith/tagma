import { Service } from '@runlith/layer/key';

export interface BuildPort {
  behind(): Promise<boolean>;
}

export class ClientBuild extends Service<BuildPort>()('ClientBuild', { tier: 'app' }) {}
