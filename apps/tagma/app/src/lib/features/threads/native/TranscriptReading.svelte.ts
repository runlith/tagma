import type { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import type { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import type { CallActivity } from '../CallActivity.svelte.js';
import type { ChatHold } from '../ChatHold.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import { ToolActivity } from './ToolActivity.svelte.js';
import { TranscriptFacts } from './TranscriptFacts.svelte.js';

export class TranscriptReading {
  readonly facts: TranscriptFacts;
  readonly activity: ToolActivity;

  constructor(shown: ShownThread, chat: ChatHold, names: ThreadNames, commands: CommandActivity, calls: CallActivity) {
    this.facts = new TranscriptFacts(() => chat.target.fold);
    this.activity = new ToolActivity(shown, names, commands, calls, () => this.facts.launches);
  }
}
