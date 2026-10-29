import { Effect, Stream } from 'effect';
import { refusing, refusingStream } from '../platform/contract/service/body.js';
import type { Automation } from './contract/service/automation.js';
import type { Pages } from './contract/service/pages.js';
import type { Screencast } from './contract/service/screencast.js';
import type { PageId } from './contract/wire/ids.js';
import type { Chosen, InputCall, ScreencastInput } from './contract/wire/screencast.js';

export const browserChannels = (pages: Pages['Service'], automation: Automation['Service'], screencast: Screencast['Service']) => {
  const resolved = (projectId: number, page: PageId) => pages.resolve({ projectId, thread: null, human: true }, page);
  return {
    'browser.pages': ({ projectId }: { readonly projectId: number }) => Stream.unwrap(pages.changes(projectId)),
    'browser.pick': ({ projectId, page }: { readonly projectId: number; readonly page: PageId }) =>
      refusingStream(Stream.unwrap(Effect.flatMap(resolved(projectId, page), (held) => automation.pick(page, held.projectId)))),
    'browser.screencast': ({ projectId, page, ...budget }: typeof ScreencastInput.Type) =>
      refusingStream(Stream.unwrap(Effect.as(resolved(projectId, page), screencast.watch(page, budget)))),
    'browser.input': ({ projectId, page, viewer, seq, events }: InputCall) =>
      refusing(Effect.andThen(resolved(projectId, page), screencast.input(page, viewer, seq, events))),
    'browser.files': ({
      projectId,
      page,
      files,
    }: {
      readonly projectId: number;
      readonly page: PageId;
      readonly files: readonly Chosen[];
    }) =>
      refusing(
        Effect.andThen(
          resolved(projectId, page),
          Effect.map(screencast.choose(page, files), (chosen) => ({ chosen })),
        ),
      ),
  };
};
