import { Platform, type PlatformSocket } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

export class LaneSockets extends Service<LaneSockets>()('LaneSockets', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new LaneSockets(platform.socket);
  }

  constructor(private readonly socket: PlatformSocket) {
    super();
  }

  open(url: string): WebSocket {
    const lane = this.socket(url);
    lane.binaryType = 'arraybuffer';
    return lane;
  }
}
