import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Schema } from 'effect';

export type Artifact = { readonly engine: Uint8Array; readonly silero: Uint8Array };

const part = Schema.Struct({ bytes: Schema.Int, digest: Schema.String });
const stored = Schema.Struct({ input: Schema.String, engine: part, silero: part });
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(stored));
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export class CacheInvalid extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
  }
}

export class ArtifactCache {
  constructor(private readonly path: string) {}

  read(input: string): Artifact | null {
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.path);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw failure;
    }
    const end = bytes.indexOf(10);
    if (end < 0) throw new CacheInvalid(this.path, 'its artifact header is missing');
    const header = decode(bytes.subarray(0, end).toString('utf8'));
    if (header._tag === 'Failure') throw new CacheInvalid(this.path, header.failure.message);
    const record = header.success;
    const start = end + 1;
    const engineEnd = start + record.engine.bytes;
    const sileroEnd = engineEnd + record.silero.bytes;
    if (record.engine.bytes < 0 || record.silero.bytes < 0 || sileroEnd !== bytes.length) {
      throw new CacheInvalid(this.path, 'its artifact lengths do not match the bytes it holds');
    }
    const engine = bytes.subarray(start, engineEnd);
    const silero = bytes.subarray(engineEnd, sileroEnd);
    if (digest(engine) !== record.engine.digest || digest(silero) !== record.silero.digest) {
      throw new CacheInvalid(this.path, 'its artifact digests do not match the bytes it holds');
    }
    return record.input === input ? { engine, silero } : null;
  }

  write(input: string, artifact: Artifact): void {
    const header = Buffer.from(
      `${JSON.stringify({
        input,
        engine: { bytes: artifact.engine.byteLength, digest: digest(artifact.engine) },
        silero: { bytes: artifact.silero.byteLength, digest: digest(artifact.silero) },
      })}\n`,
    );
    mkdirSync(dirname(this.path), { recursive: true });
    const pending = `${this.path}.${randomUUID()}.pending`;
    try {
      writeFileSync(pending, Buffer.concat([header, artifact.engine, artifact.silero]), { mode: 0o600 });
      renameSync(pending, this.path);
    } finally {
      rmSync(pending, { force: true });
    }
  }
}
