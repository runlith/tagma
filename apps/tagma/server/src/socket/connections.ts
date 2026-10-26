import { Cause, Effect, Exit } from 'effect';
import type * as Socket from 'effect/socket/Socket';

type Closing = (code: number, reason: string) => Effect.Effect<void, Socket.SocketError>;

type Revoked = { readonly code: number; readonly reason: string; readonly until: number };

const REVOKED_MS = 60_000;

export class Connections {
  private readonly open = new Map<string, Set<Closing>>();
  private readonly revoked = new Map<string, Revoked>();

  constructor(readonly remote: boolean = true) {}

  add(device: string, closing: Closing): Effect.Effect<() => void> {
    return Effect.suspend(() => {
      const ended = this.revokedNow(device);
      if (ended !== undefined) return Effect.as(closingAll([closing], ended.code, ended.reason), () => {});
      const held = this.open.get(device) ?? new Set<Closing>();
      this.open.set(device, held);
      held.add(closing);
      return Effect.succeed(() => {
        held.delete(closing);
        if (held.size === 0 && this.open.get(device) === held) this.open.delete(device);
      });
    });
  }

  revoke(device: string, code: number, reason: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const now = Date.now();
      for (const [id, ended] of this.revoked) if (ended.until <= now) this.revoked.delete(id);
      this.revoked.set(device, { code, reason, until: now + REVOKED_MS });
      return closingAll([...(this.open.get(device) ?? [])], code, reason);
    });
  }

  closeAll(code: number, reason: string): Effect.Effect<void> {
    return Effect.suspend(() =>
      closingAll(
        [...this.open.values()].flatMap((held) => [...held]),
        code,
        reason,
      ),
    );
  }

  private revokedNow(device: string): Revoked | undefined {
    const ended = this.revoked.get(device);
    if (ended === undefined || ended.until > Date.now()) return ended;
    this.revoked.delete(device);
    return undefined;
  }
}

const closingAll = (closings: readonly Closing[], code: number, reason: string): Effect.Effect<void> =>
  Effect.forEach(
    closings,
    (closing) =>
      Effect.flatMap(Effect.exit(closing(code, reason)), (closed) =>
        Exit.isFailure(closed)
          ? Effect.logWarning('a device connection did not take its close', { code, cause: Cause.pretty(closed.cause) })
          : Effect.void,
      ),
    { discard: true },
  );
