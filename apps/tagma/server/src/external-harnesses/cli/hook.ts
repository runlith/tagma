import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { hookEventOf } from '../hooks/dispatch.js';
import type { HookConnect } from '../hooks/delivery.js';
import { harnessRows, type HarnessCatalog } from '../hooks/rows.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { noting, refuse, CurrentInvocation } from '../../platform/cli/verb.js';

export const hook = ({ connect, catalog }: { readonly connect: HookConnect; readonly catalog: () => Promise<HarnessCatalog> }) =>
  Command.make(
    'hook',
    {
      event: Argument.Literals('event', [
        'session-start',
        'pre-tool-use',
        'post-tool-use',
        'stop',
        'answer',
        'permission-request',
        'observe',
      ] as const),
      harness: Flag.String('harness').pipe(
        Flag.optional,
        Flag.withMetavar('id'),
        Flag.withDescription('the installed harness whose hook file this registration was written into'),
      ),
    },
    ({ event, harness }) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const named = Option.getOrNull(harness);
        const rows = yield* harnessRows(catalog, at, yield* InstalledChannel, named).pipe(
          Effect.catchTag('HarnessUnreadable', (unreadable) =>
            Effect.sync(() =>
              refuse('harness-unreadable', unreadable.message, ['read_plugins — whether the plugin that brings it reads broken']),
            ),
          ),
        );
        if (rows === null) {
          return refuse('harness-not-installed', `no builtin harness and no plugin on this machine declares ${named}`, [
            'install_plugin — install the plugin that brings it, or turn it on again on this machine',
            'tagma upgrade — rewrite hook files written for a harness since removed',
          ]);
        }
        return yield* hookEventOf(event, at, connect, rows);
      }),
  ).pipe(
    Command.withDescription('the harness hook door: reads the event JSON on stdin and answers with what the graph knows'),
    noting(`Wired by \`tagma install\` into the project layer of every harness the repo
carries; never called by hand. Events:
  pre-tool-use   a tool is about to write a file — keeps the bytes standing
                 there, so the event after it can hand both texts to the
                 change record; answers nothing
  post-tool-use  a Read/Edit/Write touched a file — records a write as this
                 session's own typed change row, and answers the zone and its
                 law and the open work, each block once per session (the dedup
                 key is the harness session id)
  stop           the turn is ending — the words that waited for this thread
                 while the CLI worked are taken here, in the markup naming who
                 sent them, because a harness reads a prompt at a turn boundary
                 and nowhere else. A turn owing none ends in silence
  permission-request
                 the harness is about to run a tool and asks whether it may —
                 judged by the thread's permission mode over the call the
                 adapter projected; a call the mode asks about parks the
                 question on this thread's run and waits for the operator, and
                 any other call prints nothing at all, leaving the harness its
                 own prompt
--harness names a builtin harness or one an installed adapter package declares;
only that harness's declarations are loaded.
A CLI started in a Tagma terminal carries no grant: its hooks first ask the
server to adopt its session as a thread of that terminal, naming the CLI by
--harness where the hook file serves one CLI and by its published session id
where it serves several, and speak as that thread once adopted.
A hook is never the reason a turn fails: any input it cannot read, any server
it cannot reach, answers with silence.`),
  );
