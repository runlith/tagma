import { classify } from './envelope';
import type { LineAnswer, LineAsk } from './offLoop';

declare const self: Worker;

const decoder = new TextDecoder();

self.addEventListener('message', (event: MessageEvent<LineAsk>) => {
  const answer: LineAnswer = { id: event.data.id, classified: classify(decoder.decode(event.data.buffer)) };
  self.postMessage(answer);
});
