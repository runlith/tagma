import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Deltas<T> {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  read(): { readonly names: readonly string[]; readonly deltas: readonly T[] } {
    for (;;) {
      const names = readdirSync(this.directory)
        .filter((name) => name.endsWith('.json'))
        .sort();
      const deltas: T[] = [];
      for (const name of names) {
        let text: string;
        try {
          text = readFileSync(join(this.directory, name), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
          throw error;
        }
        deltas.push(JSON.parse(text) as T);
      }
      if (deltas.length === names.length) return { names, deltas };
    }
  }

  private place(name: string, delta: T): void {
    const staged = join(this.directory, `${name}.${process.pid}.${randomUUID()}.staged`);
    writeFileSync(staged, JSON.stringify(delta));
    renameSync(staged, join(this.directory, name));
  }

  write(delta: T): void {
    this.place(`${String(Date.now()).padStart(15, '0')}-${randomUUID()}.json`, delta);
  }

  replace(names: readonly string[], snapshot: T): void {
    this.place(`${names.at(-1)!.slice(0, -'.json'.length)}~.json`, snapshot);
    for (const name of names) rmSync(join(this.directory, name), { force: true });
  }
}
