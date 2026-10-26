import { Context } from 'effect';
import type { ThreadToolOutputStore } from '../../tools/outputStore.js';

export class ToolOutputs extends Context.Service<
  ToolOutputs,
  {
    readonly store: ThreadToolOutputStore;
  }
>()('tagma/native-harness/ToolOutputs') {}

export class ToolOutputsPlace extends Context.Service<
  ToolOutputsPlace,
  {
    readonly path?: string;
  }
>()('tagma/native-harness/ToolOutputsPlace') {}
