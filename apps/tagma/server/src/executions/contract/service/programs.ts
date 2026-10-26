import { Context, type Effect } from 'effect';
import type { TerminalActor } from '../wire/terminals.js';

export type ProgramTool = 'inspection' | 'commit-step' | 'config';

export type ProgramLaunch = {
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly argv: readonly [string, ...string[]];
  readonly operands?: readonly string[];
  readonly cwd: string;
  readonly policyRoot?: string;
  readonly stdin: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly tool?: ProgramTool;
  readonly operation: string;
  readonly subject: string;
};

export type ProgramEnding =
  | { readonly _tag: 'Exited'; readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly cut: boolean }
  | { readonly _tag: 'Stopped'; readonly late: boolean; readonly said: string; readonly stderr: string }
  | { readonly _tag: 'Unrun'; readonly said: string; readonly missing?: string };

export class ProgramRoad extends Context.Service<
  ProgramRoad,
  {
    run(launch: ProgramLaunch): Effect.Effect<ProgramEnding>;
  }
>()('tagma/executions/ProgramRoad') {}
