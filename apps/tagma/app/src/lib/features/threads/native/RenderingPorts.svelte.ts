import { reactiveCell } from '@runlith/roster/cell.svelte';
import { Roster } from '@runlith/roster/Roster';
import type { ChatSurfaceContext } from '@runlith/chat-ui/surface';
import type { ChatRewind } from '@runlith/chat-ui/rewind';

export class RenderingPorts {
  private readonly rewindPort = new Roster<ChatRewind>(
    () => 'Rendering rewind',
    () => 'rewind',
    reactiveCell(),
  );
  private readonly contextPort = new Roster<ChatSurfaceContext>(
    () => 'Rendering context',
    () => 'context',
    reactiveCell(),
  );

  get rewind(): ChatRewind | undefined {
    return this.rewindPort.items[0];
  }

  get context(): ChatSurfaceContext | undefined {
    return this.contextPort.items[0];
  }

  contributeRewind(contributor: string, port: ChatRewind): () => void {
    return this.rewindPort.add(contributor, port);
  }

  contributeContext(contributor: string, port: ChatSurfaceContext): () => void {
    return this.contextPort.add(contributor, port);
  }
}
