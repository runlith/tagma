import type { WindowBehaviorTransport } from '../bindings/controller.js';
import type { WindowBehaviorCommand } from '../contract/commands.js';
import type { ElectronWindowBehaviorHost } from './ElectronWindowBehaviorHost.js';

export function createTransportFromElectronHost(host: ElectronWindowBehaviorHost): WindowBehaviorTransport {
  return {
    async getState() {
      return host.getState();
    },
    async dispatch(command: WindowBehaviorCommand) {
      return host.dispatch(command);
    },
    subscribe(listener) {
      return host.subscribe(listener);
    },
  };
}
