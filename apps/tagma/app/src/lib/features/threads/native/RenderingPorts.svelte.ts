import { untrack } from 'svelte';
import { clashOf } from '@runlith/chat-ui/RegistryClash';
import type { ChatSurfaceContext } from '@runlith/chat-ui/surface';
import type { ChatRewind } from '@runlith/chat-ui/rewind';

type Held<T> = { readonly contributor: string; readonly port: T };

class Port<T> {
  private held = $state.raw<Held<T> | null>(null);

  constructor(private readonly name: string) {}

  get current(): T | undefined {
    return this.held?.port;
  }

  claim(contributor: string, port: T): () => void {
    const standing = untrack(() => this.held);
    if (standing !== null) {
      throw clashOf(`Rendering ${this.name}`, standing.contributor, contributor);
    }
    const entry: Held<T> = { contributor, port };
    this.held = entry;
    return () => {
      if (untrack(() => this.held) === entry) this.held = null;
    };
  }
}

export class RenderingPorts {
  private readonly rewindPort = new Port<ChatRewind>('rewind');
  private readonly contextPort = new Port<ChatSurfaceContext>('context');

  get rewind(): ChatRewind | undefined {
    return this.rewindPort.current;
  }

  get context(): ChatSurfaceContext | undefined {
    return this.contextPort.current;
  }

  contributeRewind(contributor: string, port: ChatRewind): () => void {
    return this.rewindPort.claim(contributor, port);
  }

  contributeContext(contributor: string, port: ChatSurfaceContext): () => void {
    return this.contextPort.claim(contributor, port);
  }
}
