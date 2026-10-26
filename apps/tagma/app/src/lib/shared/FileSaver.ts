import { Service } from '@runlith/layer/key';

export interface SavePort {
  save(blob: Blob, filename: string): void;
}

export class FileSaver extends Service<SavePort>()('FileSaver', { tier: 'app' }) {}
