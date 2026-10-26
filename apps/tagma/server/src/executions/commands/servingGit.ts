import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { Git } from '@runlith/git/Git';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { admittedGit, carriedStdin } from './admittedGit.js';
import type { CommandAccess } from '../contract/service/access.js';
import { ServingGit } from '../contract/service/git.js';
import type { ExecutionHost } from '../contract/service/host.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { Terminals } from '../contract/service/terminals.js';
import type { TerminalTargets } from '../contract/service/targets.js';

export const GIT_TOOL = 'submit_work';

export const makeServingGit = ({
  terminals,
  commands,
  host,
  access,
  targets,
  policy,
}: {
  readonly terminals: Terminals['Service'];
  readonly commands: ManagedCommands['Service'];
  readonly host: ExecutionHost['Service'];
  readonly access: CommandAccess['Service'];
  readonly targets: TerminalTargets['Service'];
  readonly policy: ExecutionPolicy;
}) =>
  ServingGit.of({
    run: Effect.fnUntraced(function* (act, platform): Effect.fn.Return<Git['Service'], StoreFailure> {
      if (!(yield* host.offersCommands())) return platform;
      const admitted = admittedGit({
        terminals,
        commands,
        access,
        targets,
        projectId: act.projectId,
        actor: { _tag: 'Thread', threadId: act.thread, projectId: act.projectId },
        owner: { _tag: 'Thread', thread: act.thread },
        creator: {
          _tag: 'Thread',
          thread: act.thread,
          toolCall: act.toolCall,
        },
        tool: GIT_TOOL,
        root: act.root,
        key: `git/${randomUUID()}`,
        bytes: policy.execution.output.retainedBytes,
      });
      return {
        objects:
          platform.objects === undefined
            ? undefined
            : (dir, oids, options) =>
                Effect.flatMap(Effect.annotateCurrentSpan({ 'git.road': 'platform', 'git.unadmitted': 'writes-its-own-input' }), () =>
                  platform.objects!(dir, oids, options),
                ),
        run: (args, options) => {
          if (carriedStdin(options) !== null && options?.stdoutBytes !== true) return admitted.run(args, options);
          const reason = options?.stdoutBytes === true ? 'reads-binary-output' : 'writes-its-own-input';
          return Effect.flatMap(Effect.annotateCurrentSpan({ 'git.road': 'platform', 'git.unadmitted': reason }), () =>
            platform.run(args, options),
          );
        },
      };
    }),
  });
