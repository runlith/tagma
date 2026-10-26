import { changeRecord as declaration } from './contract/wire/module.js';
import { Context, Effect, Layer } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { CallerChangeWork, type ChangeWork } from './contract/service/record.js';
import { HOLDINGS_FEED } from './contract/wire/holdings.js';
import { THREAD_CHANGES_FEED } from './contract/wire/threadChanges.js';
import { Holdings } from './contract/service/holdings.js';
import { ThreadChanges } from './contract/service/threadChanges.js';
import { ThreadRoots } from './contract/service/threadRoots.js';
import type { ChangesLive } from './contract/service/live.js';
import { CheckoutPlaces } from '../workspace/contract/service/checkouts.js';
import { theSharedCheckout } from './doctrine/theSharedCheckout.js';
import { StripComments, type StripCommentsRequest } from './contract/service/sweep.js';
import type { StripCommentsContext } from './sweep/stripComments.js';

const FEEDS = [HOLDINGS_FEED, THREAD_CHANGES_FEED] as const;

const live: ChangesLive = liveOf(FEEDS, async (door) =>
  (await import('./record/feed.js')).changesChannel(
    Context.get(door, CheckoutPlaces),
    Context.get(door, Holdings),
    Context.get(door, ThreadChanges),
    Context.get(door, ThreadRoots),
  ),
);

export const changeRecord = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations/pairs.js')).CHANGE_PAIRS),
  presentation: async () => (await import('./presentation.js')).CHANGES_PRESENTATION,
  tables: async () => {
    const [
      { workspaceChange, workspaceChangeText, workspaceChangeRetiredText, workspaceChangeContent, workspaceChangeReleased },
      { commandWindow, commandContent, commandUnattributed, commandUnowned, commandSignature },
    ] = await Promise.all([import('./store/tables.js'), import('./store/commandTables.js')]);
    const { checkoutSeen, changeLanding, changeLanded, changeDebt, releasedLine, retirementProof } = await import('./store/retirement.js');
    return {
      entities: [checkoutSeen, retirementProof, changeLanded, commandSignature],
      history: [
        workspaceChange,
        workspaceChangeText,
        workspaceChangeRetiredText,
        workspaceChangeContent,
        workspaceChangeReleased,
        commandWindow,
        commandContent,
        commandUnattributed,
        commandUnowned,
        changeLanding,
        changeDebt,
        releasedLine,
      ],
    };
  },
  live,
  sections: [
    {
      id: 'the-shared-checkout',
      place: { prompt: 70, law: 50 },
      owner: 'change-record',
      render: theSharedCheckout,
      path: 'src/change-record/doctrine/theSharedCheckout.ts',
      when: 'checkout',
    },
  ],
  drivers: [{ id: 'holdings-warm' }, { id: 'text-collection' }, { id: 'text-sweep' }],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ changeRecordInstallationLayer }) => changeRecordInstallationLayer,
    ),
    serving: Layer.mergeAll(
      lazyLayer(
        () => import('./record/runMarks.js'),
        ({ runMarksLayer }) => runMarksLayer,
      ),
      lazyLayer(
        () => import('./serving.js'),
        ({ changeRecordServingLayer }) => changeRecordServingLayer,
      ),
    ),
    call: (input: { readonly work: ChangeWork; readonly sweep: (request: StripCommentsRequest) => StripCommentsContext }) =>
      Context.make(CallerChangeWork, input.work).pipe(
        Context.add(StripComments, {
          strip: (request) =>
            Effect.flatMap(
              Effect.promise(() => import('./sweep/stripComments.js')),
              ({ stripComments }) => stripComments(input.sweep(request), request.path),
            ),
        }),
      ),
  },
});
