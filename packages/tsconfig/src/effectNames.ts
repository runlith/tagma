import { basename } from 'node:path';

export interface Rename {
  readonly pattern: RegExp;
  readonly v3: string;
  readonly v4: string;
}

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly v3: string;
  readonly v4: string;
}

export const RENAMES: readonly Rename[] = [
  { pattern: /\bEffect\.fork\(/, v3: 'Effect.fork', v4: 'Effect.forkChild | forkScoped | forkIn | forkDetach' },
  { pattern: /\bEffect\.catchAll\b/, v3: 'Effect.catchAll', v4: 'Effect.catch' },
  { pattern: /\bEffect\.either\b/, v3: 'Effect.either', v4: 'Effect.result (Result.isSuccess, .success / .failure)' },
  { pattern: /\bEffect\.merge\b/, v3: 'Effect.merge', v4: 'Effect.result and read both arms' },
  { pattern: /\bEffect\.zipRight\b/, v3: 'Effect.zipRight', v4: 'Effect.andThen' },
  { pattern: /\bEffect\.tapErrorCause\b/, v3: 'Effect.tapErrorCause', v4: 'Effect.tapCause' },
  { pattern: /\bEffect\.timeoutFail\b/, v3: 'Effect.timeoutFail', v4: 'Effect.timeoutOrElse({ duration, orElse })' },
  { pattern: /\bEffect\.yieldNow\(\)/, v3: 'Effect.yieldNow()', v4: 'Effect.yieldNow is a value: yield* Effect.yieldNow' },
  { pattern: /\bEffect\.gen\(\s*this\s*,/, v3: 'Effect.gen(this, …)', v4: 'Effect.gen({ self: this }, …)' },
  { pattern: /\bFiber\.poll\b/, v3: 'Fiber.poll', v4: 'Fiber.join(f).pipe(Effect.timeoutOption(Duration.zero)) — answers Option<A>' },
  { pattern: /\.unsafeInterrupt\(\)/, v3: '.unsafeInterrupt()', v4: 'Fiber.interrupt(fiber) | fiber.interruptUnsafe()' },
  { pattern: /\bStream\.runIntoSink\b/, v3: 'Stream.runIntoSink', v4: 'Stream.run(stream, sink)' },
  { pattern: /\bStream\.mapConcat\b/, v3: 'Stream.mapConcat', v4: 'none: Stream.flatMap over Stream.fromIterable' },
  { pattern: /\bStream\.unwrapScoped\b/, v3: 'Stream.unwrapScoped', v4: 'Stream.unwrap' },
  { pattern: /\bSchema\.TaggedErrorClass\b/, v3: 'Schema.TaggedErrorClass', v4: 'Schema.TaggedClass | Schema.TaggedError' },
  { pattern: /\bSchema\.optionalWith\b/, v3: 'Schema.optionalWith', v4: 'Schema.withDecodingDefaultKey | withDecodingDefaultTypeKey' },
  {
    pattern: /\bSchema\.Literal\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`|-?\d[\d_.]*|true|false|null)\s*,/,
    v3: 'Schema.Literal(a, b)',
    v4: 'Schema.Literals([a, b]); Literal takes one value',
  },
  { pattern: /\bSchema\.Union\(\s*[A-Z$_][\w$]*(?:\.[\w$]+)*(?:\([^()]*\))?\s*,/, v3: 'Schema.Union(A, B)', v4: 'Schema.Union([A, B])' },
  { pattern: /\bContext\.Tag\b/, v3: 'Context.Tag', v4: 'Context.Key | Context.Service' },
  { pattern: /\bPredicate\.isRecord\b/, v3: 'Predicate.isRecord', v4: 'Predicate.isObject' },
  { pattern: /\bScope\.CloseableScope\b/, v3: 'Scope.CloseableScope', v4: 'Scope.Closeable' },
  { pattern: /\bDuration\.DurationInput\b/, v3: 'Duration.DurationInput', v4: 'Duration.Input' },
  { pattern: /\bDuration\.decode\b/, v3: 'Duration.decode', v4: 'Duration.millis | Duration.toMillis' },
  { pattern: /\bEffect\.Effect\.Success\b/, v3: 'Effect.Effect.Success', v4: 'Effect.Success' },
  { pattern: /from\s+['"]effect\/Mutex['"]|\bMutex\.make\b/, v3: 'Mutex', v4: 'none: Semaphore.make(1)' },
  { pattern: /\bEffect\.makeSemaphore\b/, v3: 'Effect.makeSemaphore', v4: 'Semaphore.make(permits) from effect' },
  {
    pattern: /from\s+['"]effect\/unstable\//,
    v3: "from 'effect/unstable/…'",
    v4: "from 'effect/<area>' — effect/http, effect/http-api (was httpapi), effect/rpc, effect/process, effect/sql, …",
  },
  {
    pattern:
      /from\s+['"]effect\/Encoding['"]|\bEncoding\.(randomHex|encodeBase64Url|encodeBase64|decodeBase64Url|decodeBase64|encodeHex|decodeHex)\b/,
    v3: 'Encoding',
    v4: 'effect/encoding/Hex | Base64 | Base64Url: Hex.random, Base64Url.encode, …',
  },
  {
    pattern: /\bFileSystem\.Size\b/,
    v3: 'FileSystem.Size',
    v4: 'ByteSize.bytes(n); File.Info.size is a ByteSize, seek takes and answers bigint',
  },
  {
    pattern: /\bRpcSerialization\.(layerMsgPack|msgPack)\b/,
    v3: 'RpcSerialization.msgPack',
    v4: 'RpcSerialization.layerJson | layerNdjson | layerSchemaBinary',
  },
  {
    pattern: /\bSchema\.is(LengthBetween|SizeBetween|PropertiesLengthBetween|StartsWith|EndsWith|Includes)\b/,
    v3: 'Schema.isLengthBetween',
    v4: 'Schema.isBetweenLength | isBetweenSize | isBetweenProperties | isStartingWith | isEndingWith | isIncluding',
  },
  {
    pattern: /\b(Flag|Argument|Param|Primitive)\.(string|boolean|integer|float|choice|none|path|file|directory|date|redacted)\(/,
    v3: 'Flag.string',
    v4: 'PascalCase constructors: Flag.String, Boolean, Int (was integer), Finite (was float), Literals (was choice), Never',
  },
  {
    pattern: /\.annotate\(\{\s*parseOptions\b/,
    v3: 'annotate({ parseOptions })',
    v4: 'pass ParseOptions to the decode call: decodeUnknownEffect(schema)(input, { onExcessProperty })',
  },
  {
    pattern: /\bsocket\.(run|runRaw|runString)\(|\.runRaw\(/,
    v3: 'socket.run',
    v4: 'Socket.readerBytes(socket) in a scope, then pull in a loop; the writer is { write, writeAll }',
  },
  { pattern: /\bFileSystem\.OpenFileOptions\b/, v3: 'FileSystem.OpenFileOptions', v4: "Parameters<FileSystem.FileSystem['open']>[1]" },
  {
    pattern: /\bChildProcess\.ChildProcess\b/,
    v3: 'ChildProcess.ChildProcess',
    v4: "ChildProcessSpawner.ChildProcessSpawner from 'effect/process'",
  },
  { pattern: /catchTag\(\s*['"]TimeoutException['"]/, v3: "catchTag('TimeoutException')", v4: "catchTag('TimeoutError', …)" },
  {
    pattern: /import\s*\{[^}]*\b(Effect|Layer|Stream|Schema|Fiber|Scope|Context|Duration)\b[^}]*\}\s*from\s*['"]effect\/\1['"]/,
    v3: "import { Effect } from 'effect/Effect'",
    v4: "import { Effect } from 'effect' (the root barrel), or import * as Effect from 'effect/Effect'",
  },
];

const OWN = new Set(['effectNames.ts', 'effectNames.test.ts']);

export function skipped(path: string): boolean {
  return OWN.has(basename(path));
}

export function detect(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split('\n').forEach((line, index) => {
    for (const rename of RENAMES) {
      if (rename.pattern.test(line)) findings.push({ path, line: index + 1, v3: rename.v3, v4: rename.v4 });
    }
  });
  return findings;
}
