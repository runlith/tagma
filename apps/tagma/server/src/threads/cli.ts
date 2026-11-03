import type { ThreadsCli } from './cli/turnVerbs.js';

const TURN_VERBS = ['ask', 'reply', 'steer', 'stop', 'continue', 'compact', 'unqueue'] as const;
const THREAD_VERBS = ['threads', 'thread', 'activity'] as const;

export const threadsVerbs = (threads: () => Promise<ThreadsCli>) => {
  const turns = async () => {
    const [{ threadTurns }, port] = await Promise.all([import('./cli/turnVerbs.js'), threads()]);
    return threadTurns(port);
  };
  const listed = async () => {
    const [{ threadCommands }, port] = await Promise.all([import('./cli/threadVerbs.js'), threads()]);
    return threadCommands(port);
  };
  return {
    ...Object.fromEntries(TURN_VERBS.map((verb) => [verb, turns] as const)),
    ...Object.fromEntries(THREAD_VERBS.map((verb) => [verb, listed] as const)),
  };
};
