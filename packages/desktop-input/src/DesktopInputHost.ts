import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';
import { createDeferred } from '@runlith/utils/async';
import type {
  DesktopAccessibilityState,
  DesktopHold,
  DesktopInputHost,
  DesktopInputIssue,
  DesktopInputStartResult,
  HoldBinding,
  PasteOutcome,
} from './contract/types.js';
import { parseSidecarLine } from './internal/protocol.js';
import { resolveDesktopInputBinary } from './internal/resolve-binary.js';

const PASTE_TIMEOUT_MS = 2_000;
const SHUTDOWN_GRACE_MS = 1_000;

interface Latch<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  settle(value: T): void;
}

function createLatch<T>(): Latch<T> {
  const deferred = createDeferred<T>();
  let settled = false;
  return {
    promise: deferred.promise,
    get settled() {
      return settled;
    },
    settle(value: T) {
      if (settled) return;
      settled = true;
      deferred.resolve(value);
    },
  };
}

interface DesktopInputHostDependencies {
  readonly platform?: string;
  readonly moduleUrl?: string;
  readonly binaryPath?: string;
  readonly spawnSidecar?: (binaryPath: string) => ChildProcessWithoutNullStreams;
}

type SidecarCommand =
  | {
      readonly type: 'bind';
      readonly kind?: HoldBinding['kind'];
      readonly keyCode?: number;
      readonly modifier?: string;
      readonly modifiers?: readonly string[];
    }
  | { readonly type: 'swallow' | 'escape'; readonly on: boolean }
  | { readonly type: 'paste'; readonly id: string; readonly text: string; readonly restore: boolean }
  | { readonly type: 'prompt-accessibility' | 'recheck' | 'shutdown' };

const UNKNOWN_ACCESSIBILITY: DesktopAccessibilityState = { trusted: false, tapActive: false };

class Listeners<T> {
  readonly #all = new Set<(value: T) => void>();

  add(listener: (value: T) => void): () => void {
    this.#all.add(listener);
    return () => {
      this.#all.delete(listener);
    };
  }

  tell(value: T): void {
    for (const listener of this.#all) listener(value);
  }

  clear(): void {
    this.#all.clear();
  }
}

class DarwinDesktopInputHost implements DesktopInputHost {
  #child: ChildProcessWithoutNullStreams | null = null;
  #reader: Interface | null = null;
  #accessibility: DesktopAccessibilityState = UNKNOWN_ACCESSIBILITY;
  #startResult: Latch<DesktopInputStartResult> | null = null;
  #disposed = false;

  readonly #holds = new Listeners<DesktopHold>();
  readonly #escapes = new Listeners<void>();
  readonly #accessibilityListeners = new Listeners<DesktopAccessibilityState>();
  readonly #losses = new Listeners<string>();
  readonly #pendingPastes = new Map<string, Latch<PasteOutcome>>();

  private readonly platform: string;
  private readonly moduleUrl: string;
  private readonly explicitBinaryPath: string | undefined;
  private readonly spawnSidecar: (binaryPath: string) => ChildProcessWithoutNullStreams;

  constructor(deps: DesktopInputHostDependencies = {}) {
    this.platform = deps.platform ?? process.platform;
    this.moduleUrl = deps.moduleUrl ?? import.meta.url;
    this.explicitBinaryPath = deps.binaryPath;
    this.spawnSidecar = deps.spawnSidecar ?? ((binaryPath) => spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] }));
  }

  get accessibility(): DesktopAccessibilityState {
    return this.#accessibility;
  }

  async start(): Promise<DesktopInputStartResult> {
    if (this.#startResult) {
      return this.#startResult.promise;
    }
    const startResult = createLatch<DesktopInputStartResult>();
    this.#startResult = startResult;

    if (this.platform !== 'darwin') {
      startResult.settle({ status: 'unsupported', issue: unsupportedPlatformIssue(this.platform) });
      return startResult.promise;
    }

    const binaryPath = this.explicitBinaryPath ?? resolveDesktopInputBinary(this.moduleUrl);
    if (!binaryPath) {
      startResult.settle({ status: 'unsupported', issue: missingBinaryIssue() });
      return startResult.promise;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnSidecar(binaryPath);
    } catch (error) {
      startResult.settle({ status: 'unsupported', issue: spawnFailedIssue(error) });
      return startResult.promise;
    }

    this.#child = child;

    child.on('error', (error) => {
      startResult.settle({ status: 'unsupported', issue: spawnFailedIssue(error) });
    });
    child.on('exit', (code, signal) => {
      this.#failPendingPastes('the desktop-input helper exited');
      startResult.settle({ status: 'unsupported', issue: spawnFailedIssue('sidecar exited before ready') });
      if (this.#child !== child) return;
      this.#child = null;
      if (this.#disposed) return;
      this.#setAccessibility({ trusted: this.#accessibility.trusted, tapActive: false });
      this.#losses.tell(`The desktop-input helper exited (${signal ?? `code ${code}`}).`);
    });

    const reader = createInterface({ input: child.stdout });
    this.#reader = reader;
    reader.on('line', (line) => this.#handleLine(line, startResult));

    return startResult.promise;
  }

  bind(binding: HoldBinding | null): void {
    if (binding === null) this.#send({ type: 'bind' });
    else if (binding.kind === 'modifier')
      this.#send({ type: 'bind', kind: 'modifier', keyCode: binding.keyCode, modifier: binding.modifier });
    else this.#send({ type: 'bind', kind: 'key', keyCode: binding.keyCode, modifiers: binding.modifiers });
  }

  swallow(on: boolean): void {
    this.#send({ type: 'swallow', on });
  }

  watchEscape(on: boolean): void {
    this.#send({ type: 'escape', on });
  }

  onHold(listener: (hold: DesktopHold) => void): () => void {
    return this.#holds.add(listener);
  }

  onEscape(listener: () => void): () => void {
    return this.#escapes.add(listener);
  }

  onAccessibilityChange(listener: (state: DesktopAccessibilityState) => void): () => void {
    return this.#accessibilityListeners.add(listener);
  }

  onLost(listener: (reason: string) => void): () => void {
    return this.#losses.add(listener);
  }

  async paste(text: string, options: { readonly restore?: boolean } = {}): Promise<PasteOutcome> {
    const child = this.#child;
    if (!child || this.#disposed) return { ok: false, reason: 'the desktop-input helper is not running' };

    const id = randomUUID();
    const latch = createLatch<PasteOutcome>();
    this.#pendingPastes.set(id, latch);

    const timeout = setTimeout(() => {
      latch.settle({ ok: false, reason: 'the desktop-input helper did not answer the paste' });
    }, PASTE_TIMEOUT_MS);
    timeout.unref?.();

    this.#send({ type: 'paste', id, text, restore: options.restore !== false });

    try {
      return await latch.promise;
    } finally {
      clearTimeout(timeout);
      this.#pendingPastes.delete(id);
    }
  }

  promptAccessibility(): void {
    this.#send({ type: 'prompt-accessibility' });
  }

  recheckAccessibility(): void {
    this.#send({ type: 'recheck' });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    this.#failPendingPastes('the desktop-input helper was stopped');
    this.#send({ type: 'shutdown' });

    this.#reader?.close();
    this.#reader = null;

    const child = this.#child;
    this.#child = null;
    if (child && child.exitCode === null) {
      const kill = setTimeout(() => child.kill('SIGTERM'), SHUTDOWN_GRACE_MS);
      kill.unref?.();
      child.once('exit', () => clearTimeout(kill));
    }

    this.#holds.clear();
    this.#escapes.clear();
    this.#accessibilityListeners.clear();
    this.#losses.clear();
  }

  #handleLine(line: string, startResult: Latch<DesktopInputStartResult>): void {
    const message = parseSidecarLine(line);
    if (!message) return;

    switch (message.kind) {
      case 'ready': {
        this.#setAccessibility({
          trusted: message.data.accessibilityTrusted,
          tapActive: message.data.tapActive,
        });
        startResult.settle({ status: 'started', accessibility: this.#accessibility });
        return;
      }
      case 'accessibility': {
        this.#setAccessibility({ trusted: message.data.trusted, tapActive: message.data.tapActive });
        return;
      }
      case 'hold': {
        this.#holds.tell(message.data);
        return;
      }
      case 'escape': {
        this.#escapes.tell();
        return;
      }
      case 'paste_result': {
        const { id, ok, error } = message.data;
        this.#pendingPastes.get(id)?.settle(ok ? { ok: true } : { ok: false, reason: error ?? 'the paste failed' });
        return;
      }
      case 'error':
        return;
    }
  }

  #setAccessibility(state: DesktopAccessibilityState): void {
    if (state.trusted === this.#accessibility.trusted && state.tapActive === this.#accessibility.tapActive) {
      this.#accessibility = state;
      return;
    }
    this.#accessibility = state;
    this.#accessibilityListeners.tell(state);
  }

  #failPendingPastes(reason: string): void {
    for (const [, latch] of this.#pendingPastes) latch.settle({ ok: false, reason });
    this.#pendingPastes.clear();
  }

  #send(command: SidecarCommand): void {
    const child = this.#child;
    if (!child?.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(command)}\n`);
  }
}

function unsupportedPlatformIssue(platform: string): DesktopInputIssue {
  return {
    code: 'unsupported-platform',
    message: `Desktop input capture is not supported on ${platform}.`,
  };
}

function missingBinaryIssue(): DesktopInputIssue {
  return {
    code: 'native-binary-missing',
    message: 'The desktop-input helper binary is missing. Build it before running.',
    details: { reason: 'runlith-desktop-input was not found in the package bin directory.' },
  };
}

function spawnFailedIssue(error: unknown): DesktopInputIssue {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    code: 'spawn-failed',
    message: 'The desktop-input helper could not start.',
    details: { reason },
  };
}

export function createDesktopInputHost(deps: DesktopInputHostDependencies = {}): DesktopInputHost {
  return new DarwinDesktopInputHost(deps);
}
