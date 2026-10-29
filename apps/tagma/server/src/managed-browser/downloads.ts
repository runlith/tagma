import { join } from 'node:path';
import { type CdpEvent, eventParams, type Session } from '@runlith/cdp/session';
import { Clock, Effect, PubSub } from 'effect';
import type { HostEvent } from '../browser/contract/wire/host.js';
import type { PageId } from '../browser/contract/wire/ids.js';
import type { Download } from '../browser/contract/wire/page.js';
import type { NavigationGate } from './navigation.js';

type Held = { readonly page: PageId; download: Download };

type Input = {
  readonly directory: string;
  readonly navigation: NavigationGate;
  readonly events: PubSub.PubSub<HostEvent>;
};

export const makeDownloads = (input: Input) => {
  const held = new Map<string, Held>();
  return {
    start: (browser: Session) =>
      Effect.asVoid(
        browser.send('Browser.setDownloadBehavior', {
          behavior: 'allowAndName',
          downloadPath: input.directory,
          eventsEnabled: true,
        }),
      ),
    take: Effect.fnUntraced(function* (event: CdpEvent) {
      switch (event.method) {
        case 'Browser.downloadWillBegin': {
          const begun = yield* eventParams('Browser.downloadWillBegin', event);
          const page = input.navigation.page(begun.frameId);
          if (page === null) return;
          const download: Download = {
            id: begun.guid,
            name: begun.suggestedFilename,
            path: join(input.directory, begun.guid),
            bytes: null,
            state: 'running',
            at: new Date(yield* Clock.currentTimeMillis).toISOString(),
          };
          held.set(begun.guid, { page, download });
          yield* PubSub.publish(input.events, { kind: 'download', page, download });
          return;
        }
        case 'Browser.downloadProgress': {
          const progress = yield* eventParams('Browser.downloadProgress', event);
          const current = held.get(progress.guid);
          if (current === undefined || progress.state === 'inProgress') return;
          current.download = {
            ...current.download,
            bytes: progress.receivedBytes,
            state: progress.state === 'completed' ? 'done' : 'cancelled',
          };
          held.delete(progress.guid);
          yield* PubSub.publish(input.events, { kind: 'download', page: current.page, download: current.download });
          return;
        }
      }
    }),
  };
};

export type Downloads = ReturnType<typeof makeDownloads>;
