import { LLMEvent, LLMResponse } from './events';
import * as ResponseFold from './responseFold';

const deltaCount = 2_000;
const text = 'x'.repeat(200 * 1024);
const chunkSize = Math.ceil(text.length / deltaCount);
const events = [
  LLMEvent.textStart({ id: 'text-1' }),
  ...Array.from({ length: deltaCount }, (_, index) =>
    LLMEvent.textDelta({ id: 'text-1', text: text.slice(index * chunkSize, (index + 1) * chunkSize) }),
  ),
  LLMEvent.textEnd({ id: 'text-1' }),
  LLMEvent.finish({ reason: 'stop' }),
];

const run = () => {
  let state = ResponseFold.empty();
  for (const event of events) state = ResponseFold.reduce(state, event);
  const response = ResponseFold.complete(state);
  if (response?.text.length !== text.length) throw new Error(`wrong response length ${response?.text.length}`);
};

for (let warm = 0; warm < 3; warm++) run();
const passes = 10;
const started = performance.now();
for (let pass = 0; pass < passes; pass++) run();
console.log(
  `${(text.length / 1024).toFixed(0)} KiB response in ${deltaCount} deltas: ${((performance.now() - started) / passes).toFixed(3)} ms`,
);
