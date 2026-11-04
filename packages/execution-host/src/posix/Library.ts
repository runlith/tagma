import { Data, Effect, FileSystem } from 'effect';
import { createHash } from 'node:crypto';
import { Abi, type ProcessAbi } from './ProcessAbi';

export type ResolvedPackage = { readonly name: string; readonly version: string; readonly checksum?: string };

export type NativeBuild = {
  readonly crate: string;
  readonly version: string;
  readonly target: string;
  readonly profile: string;
  readonly rustc: string;
  readonly source: string;
  readonly closure: ReadonlyArray<ResolvedPackage>;
  readonly digest: string;
};

export class LibraryUnavailable extends Data.TaggedError('LibraryUnavailable')<{
  readonly path: string;
  readonly reason: 'missing-artifact' | 'load-failed' | 'identity-unreadable';
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.path}: ${this.detail}`;
  }
}

export type LoadedLibrary = {
  readonly path: string;
  readonly build: NativeBuild;
  readonly abi: ProcessAbi;
};

export const loadLibrary = Effect.fn('posix.Library.open')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  const exists = yield* files
    .exists(path)
    .pipe(Effect.mapError((error) => new LibraryUnavailable({ path, reason: 'load-failed', detail: String(error) })));
  if (!exists) return yield* new LibraryUnavailable({ path, reason: 'missing-artifact', detail: 'no file at that path' });
  return yield* Effect.acquireRelease(
    Effect.suspend(() => {
      let abi: Abi;
      try {
        abi = Abi.load(path);
      } catch (error) {
        return Effect.fail(new LibraryUnavailable({ path, reason: 'load-failed', detail: String(error) }));
      }
      const build = parseIdentity(abi.identity());
      if (build === undefined) {
        abi.unload();
        return Effect.fail(
          new LibraryUnavailable({ path, reason: 'identity-unreadable', detail: 'the library reports no parsable identity' }),
        );
      }
      return Effect.succeed({ path, build, abi });
    }),
    (loaded) => Effect.sync(() => loaded.abi.unload()),
  );
});

function parseIdentity(text: string): NativeBuild | undefined {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1));
  }
  const crate = fields.get('crate');
  const version = fields.get('version');
  const target = fields.get('target');
  const profile = fields.get('profile');
  const rustc = fields.get('rustc');
  const source = fields.get('source');
  const closure = fields.get('closure');
  if (!crate || !version || !target || !profile || !rustc || !source || closure === undefined) return undefined;
  const packages: ResolvedPackage[] = [];
  for (const entry of closure.split(';')) {
    if (entry.length === 0) continue;
    const [name, packageVersion, checksum] = entry.split(' ');
    if (!name || !packageVersion) return undefined;
    packages.push(checksum ? { name, version: packageVersion, checksum } : { name, version: packageVersion });
  }
  return { crate, version, target, profile, rustc, source, closure: packages, digest: createHash('sha256').update(text).digest('hex') };
}
