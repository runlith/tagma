import type { DesktopWindows } from '@tagma/desktop/bridge';
import { type WindowAddress, type WindowPort, windowKey, windowPath } from './ViewWindows.js';

export class NativeWindows implements WindowPort {
  constructor(private readonly desktop: DesktopWindows) {}

  open(address: WindowAddress): void {
    this.desktop.open({ key: windowKey(address), path: windowPath(address), title: address.title });
  }
}
