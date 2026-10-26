import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED } from '../platform/contract/service/presentation.js';
import { measured, performanceAnswerText } from './voice.js';

const asked = (input: Partial<Record<string, unknown>>): string | undefined => (typeof input.type === 'string' ? input.type : undefined);

export const PERFORMANCE_PRESENTATION: ModulePresentation = {
  voice: (answer) => Effect.succeed(performanceAnswerText(answer) ?? UNVOICED),
  called: (input) => ({ form: 'none', title: asked(input) }),
  settled: (_input, answer) => {
    const read = measured(answer);
    return read === null ? undefined : { form: 'none', title: `performance ${read.performance.type}` };
  },
};
