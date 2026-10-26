import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Records {
  constructor(readonly root: string) {}
  read<T>(key: string): T | undefined {
    const path = join(this.root, `${key}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
  }
  write(key: string, value: unknown): void {
    const path = join(this.root, `${key}.json`);
    const staged = `${path}.${process.pid}.${randomUUID()}`;
    writeFileSync(staged, JSON.stringify(value));
    renameSync(staged, path);
  }
}
