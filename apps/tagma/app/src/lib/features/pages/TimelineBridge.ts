import { Schema } from 'effect';
import { HOST_MESSAGES, type HostMessage, PAGE_MESSAGES, pageMessageSchema } from '@tagma/server/artifacts/contract/wire/timeline';

export type TimelineFrame = {
  readonly source: () => unknown;
  readonly post: (message: HostMessage) => void;
};

export type TimelineEvents = {
  readonly ready: () => void;
  readonly drawn: (k: number, failure: string | null) => void;
};

export type TimelineMessage = { readonly source: unknown; readonly data: unknown };

const told = Schema.decodeUnknownOption(pageMessageSchema);

export class TimelineBridge {
  private ready = false;
  private shown: number | null = null;
  private flying: number | null = null;
  private wanted = 0;

  constructor(
    private readonly frame: TimelineFrame,
    private readonly events: TimelineEvents,
  ) {}

  receive(message: TimelineMessage): void {
    if (message.source === null || message.source !== this.frame.source()) return;
    const read = told(message.data);
    if (read._tag === 'None') return;
    const said = read.value;
    if (said.type === PAGE_MESSAGES.ready) {
      if (this.ready) return;
      this.ready = true;
      this.shown = null;
      this.flying = null;
      this.events.ready();
      this.send();
      return;
    }
    if (said.k !== this.flying) return;
    this.flying = null;
    this.shown = said.k;
    this.events.drawn(said.k, said.error ?? null);
    this.send();
  }

  hello(): void {
    this.ready = false;
    this.shown = null;
    this.flying = null;
    this.frame.post({ type: HOST_MESSAGES.hello });
  }

  seek(k: number): void {
    this.wanted = k;
    this.send();
  }

  private send(): void {
    if (!this.ready || this.flying !== null || this.wanted === this.shown) return;
    this.flying = this.wanted;
    this.frame.post({ type: HOST_MESSAGES.seek, k: this.wanted });
  }
}
