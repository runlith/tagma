import { SENDING_PATH } from '@tagma/server/speech/contract/wire/listening';
import { Platform, type PlatformSocket } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { ServerOrigin } from './ServerOrigin.svelte.js';

export class SoundChannel extends Service<SoundChannel>()('SoundChannel', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new SoundChannel(platform.socket, yield* ServerOrigin);
  }

  constructor(
    private readonly socket: PlatformSocket,
    private readonly origin: ServerOrigin,
  ) {
    super();
  }

  open(recognition: string, track: string): WebSocket {
    const query = new URLSearchParams({ id: recognition, track });
    const channel = this.socket(this.origin.socket(`${SENDING_PATH}?${query}`));
    channel.binaryType = 'arraybuffer';
    return channel;
  }
}
