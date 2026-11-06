import { createHash } from 'node:crypto';

type FilesHasher = { add(path: string, bytes: Uint8Array): void; digest(): string };

export const filesHasher = (): FilesHasher => {
  const hash = createHash('sha256');
  return {
    add: (path, bytes) => {
      hash.update(`${path}\u0000${bytes.byteLength}\u0000`);
      hash.update(bytes);
    },
    digest: () => hash.digest('hex'),
  };
};
