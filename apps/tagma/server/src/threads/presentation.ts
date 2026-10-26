import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED } from '../platform/contract/service/presentation.js';
import type { ThreadToolAnswer } from './contract/wire/evidenceInput.js';
import { THREAD_OPERATION_IDS } from './contract/wire/operations/catalog.js';
import { SEARCH_OPERATION_IDS } from './contract/wire/operations/search.js';
import { threadToolText } from './voice/answers.js';
import { threadCalledDisplay, type ThreadToolInput } from './contract/wire/called.js';
import { threadSettledDisplay } from './voice/display.js';

export const THREADS_PRESENTATION: ModulePresentation = {
  operations: [...THREAD_OPERATION_IDS, ...SEARCH_OPERATION_IDS],
  voice: (answer) => Effect.sync(() => threadToolText(answer as ThreadToolAnswer) ?? UNVOICED),
  called: threadCalledDisplay,
  settled: (input, answer) => threadSettledDisplay(input as ThreadToolInput, answer as ThreadToolAnswer),
};
