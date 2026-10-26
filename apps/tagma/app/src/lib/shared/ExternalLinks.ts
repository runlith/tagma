import { Service } from '@runlith/layer/key';

export interface LinkPort {
  open(url: string): void;
}

export class ExternalLinks extends Service<LinkPort>()('ExternalLinks', { tier: 'app' }) {}
