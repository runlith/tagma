import { Data, PlatformError } from 'effect';

export type GuestRequest = { readonly op: string } & Record<string, unknown>;

export type GuestAnswer = { readonly value: Record<string, unknown>; readonly payload: Uint8Array };

export class GuestChannelLost extends Data.TaggedError('GuestChannelLost')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `the guest channel is broken: ${this.reason}`;
  }
}

export class GuestUnavailable extends Data.TaggedError('GuestUnavailable')<{
  readonly container: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `the guest container ${this.container} could not be reached: ${this.reason}`;
  }
}

const FRAME_SEPARATOR = 0x0a;

export function askFrame(id: number, ask: GuestRequest, payload: Uint8Array | undefined): Uint8Array {
  const bytes = payload?.length ?? 0;
  const header = new TextEncoder().encode(`${JSON.stringify({ id, ...ask, bytes: bytes > 0 ? bytes : undefined })}\n`);
  if (bytes === 0) return header;
  const framed = new Uint8Array(header.length + bytes);
  framed.set(header, 0);
  framed.set(payload as Uint8Array, header.length);
  return framed;
}

export type GuestFrame = {
  readonly id: number;
  readonly ok: boolean;
  readonly value: Record<string, unknown>;
  readonly payload: Uint8Array;
};

export class GuestFrames {
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private head: {
    readonly id: number;
    readonly ok: boolean;
    readonly value: Record<string, unknown>;
    readonly bytes: number;
  } | null = null;

  read(chunk: Uint8Array): readonly GuestFrame[] {
    this.buffered = this.buffered.length === 0 ? chunk : concat(this.buffered, chunk);
    const frames: GuestFrame[] = [];
    for (;;) {
      if (this.head === null) {
        const end = this.buffered.indexOf(FRAME_SEPARATOR);
        if (end < 0) return frames;
        const header = JSON.parse(new TextDecoder().decode(this.buffered.subarray(0, end))) as Record<string, unknown>;
        this.buffered = this.buffered.subarray(end + 1);
        const { id, ok, bytes, ...rest } = header;
        this.head = {
          id: typeof id === 'number' ? id : -1,
          ok: ok === true,
          value: rest,
          bytes: typeof bytes === 'number' ? bytes : 0,
        };
      }
      if (this.buffered.length < this.head.bytes) return frames;
      const payload = this.buffered.slice(0, this.head.bytes);
      this.buffered = this.buffered.subarray(this.head.bytes);
      frames.push({ id: this.head.id, ok: this.head.ok, value: this.head.value, payload });
      this.head = null;
    }
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

const REASONS: Record<string, PlatformError.SystemErrorTag> = {
  ENOENT: 'NotFound',
  EACCES: 'PermissionDenied',
  EPERM: 'PermissionDenied',
  EEXIST: 'AlreadyExists',
  EISDIR: 'BadResource',
  ENOTDIR: 'BadResource',
  EBADF: 'BadResource',
  ELOOP: 'BadResource',
  EBUSY: 'Busy',
  ENOSYS: 'Unknown',
};

export function guestFailure(method: string, path: string | undefined, reported: Record<string, unknown>): PlatformError.PlatformError {
  const code = typeof reported.code === 'string' ? reported.code : 'UNKNOWN';
  return PlatformError.systemError({
    _tag: REASONS[code] ?? 'Unknown',
    module: 'FileSystem',
    method,
    description: typeof reported.message === 'string' ? reported.message : code,
    cause: { code },
    syscall: typeof reported.syscall === 'string' ? reported.syscall : undefined,
    pathOrDescriptor: path,
  });
}

export function brokenAsFailure(method: string, broken: GuestChannelLost): PlatformError.PlatformError {
  return PlatformError.systemError({
    _tag: 'BadResource',
    module: 'FileSystem',
    method,
    description: broken.reason,
  });
}
