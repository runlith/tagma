import type { RemoteDebugger } from 'appium-remote-debugger';
import { Data, Schema } from 'effect';

export class InspectorFailed extends Data.TaggedError('InspectorFailed')<{ readonly message: string; readonly cause?: unknown }> {}
export type PageRoute = { readonly appId: number; readonly pageId: number };
const Connection = Schema.Struct({ connId: Schema.String, senderId: Schema.String, targetId: Schema.String });
const Target = Schema.Struct({
  app: Schema.String,
  info: Schema.Struct({ targetId: Schema.String, type: Schema.String, isPaused: Schema.optional(Schema.Boolean) }),
});

export const bootstrap = async (
  debugger_: RemoteDebugger,
  page: PageRoute,
  script: string,
  failed: (cause: unknown) => void,
): Promise<() => void> => {
  const client = debugger_.requireRpcClient();
  const route = { appIdKey: `PID:${page.appId}` as const, pageIdKey: String(page.pageId) };
  const connection = Schema.decodeUnknownSync(Connection)(
    await client.sendToDevice('Runtime.evaluate', { ...route, expression: 'void 0' }, false),
  );
  await client.send('Target.setPauseOnStart', { ...route, pauseOnStart: true });
  let sequence = -1;
  let active = true;
  const pending = new Map<() => void, (cause: unknown) => void>();
  const report = (cause: unknown) => {
    if (active) failed(cause);
  };
  const send = (targetId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const id = sequence--;
      const envelope = sequence--;
      const cleanup = () => {
        client.off(String(id), completed);
        client.off(String(envelope), acknowledged);
        pending.delete(cleanup);
      };
      const completed = (cause: unknown) => {
        cleanup();
        if (cause) reject(new InspectorFailed({ message: 'WebKit rejected the document bootstrap', cause }));
        else resolve();
      };
      const acknowledged = (cause: unknown) => {
        if (cause) completed(cause);
      };
      pending.set(cleanup, completed);
      client.once(String(id), completed);
      client.once(String(envelope), acknowledged);
      void client
        .sendMessage({
          __selector: '_rpc_forwardSocketData:',
          __argument: {
            WIRConnectionIdentifierKey: connection.connId,
            WIRSenderKey: connection.senderId,
            WIRApplicationIdentifierKey: route.appIdKey,
            WIRPageIdentifierKey: page.pageId,
            WIRSocketDataKey: Buffer.from(
              JSON.stringify({
                id: envelope,
                method: 'Target.sendMessageToTarget',
                params: { targetId, message: JSON.stringify({ id, method: 'Page.setBootstrapScript', params: { source: script } }) },
              }),
            ),
          },
        })
        .catch(completed);
    });
  const created = (cause: unknown, app: unknown, info: unknown) => {
    if (cause) {
      report(cause);
      return;
    }
    try {
      const target = Schema.decodeUnknownSync(Target)({ app, info });
      if (target.app !== route.appIdKey || target.info.type !== 'page') return;
      if (target.info.isPaused !== true) throw new InspectorFailed({ message: 'WebKit created an unpaused document before its bootstrap' });
      void send(target.info.targetId).catch(report);
    } catch (cause) {
      report(cause);
    }
  };
  const disconnected = () => {
    const cause = new InspectorFailed({ message: 'Web Inspector disconnected before document bootstrap completed' });
    for (const complete of pending.values()) complete(cause);
    report(cause);
  };
  const dispose = () => {
    active = false;
    client.off('Target.targetCreated', created);
    debugger_.off('remote_debugger_disconnect', disconnected);
    for (const complete of pending.values()) complete(new InspectorFailed({ message: 'Web Inspector bootstrap scope closed' }));
  };
  client.on('Target.targetCreated', created);
  debugger_.once('remote_debugger_disconnect', disconnected);
  try {
    await send(connection.targetId);
  } catch (cause) {
    dispose();
    throw cause;
  }
  return dispose;
};
