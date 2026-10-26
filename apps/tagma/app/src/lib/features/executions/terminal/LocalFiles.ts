import { Service } from '@runlith/layer/key';

export type LocalFilesPort = {
  readonly pathOf: (file: File) => string;
};

export class LocalFiles extends Service<LocalFilesPort>()('LocalFiles', { tier: 'app' }) {}
