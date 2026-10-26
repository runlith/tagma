import type { ToolWords } from '../tool/words';

export const COLLABORATION_WORDS = {
  list_agents: {
    running: 'Reading the roster',
    done: 'Read the roster',
    many: (count) => `Read the roster ${count} times`,
  },
  spawn_agent: { running: 'Starting', runningAlone: 'Starting an agent', done: 'Started', doneAlone: 'Started an agent' },
  send_message: { running: 'Writing to', runningAlone: 'Writing to an agent', done: 'Wrote to', doneAlone: 'Wrote to an agent' },
  send_task: {
    running: 'Handing work to',
    runningAlone: 'Handing work to an agent',
    done: 'Handed work to',
    doneAlone: 'Handed work to an agent',
  },
  interrupt_agent: { running: 'Cutting short', runningAlone: 'Cutting short an agent', done: 'Cut short', doneAlone: 'Cut short an agent' },
  answer_approval: {
    running: 'Answering for',
    runningAlone: 'Answering an approval',
    done: 'Answered for',
    doneAlone: 'Answered an approval',
  },
  stop_agent: { running: 'Stopping', runningAlone: 'Stopping an agent', done: 'Stopped', doneAlone: 'Stopped an agent' },
  continue_agent: { running: 'Continuing', runningAlone: 'Continuing an agent', done: 'Continued', doneAlone: 'Continued an agent' },
  set_agent_model: {
    running: 'Moving',
    runningAlone: 'Moving an agent to another model',
    done: 'Moved',
    doneAlone: 'Moved an agent to another model',
  },
  compact_agent: {
    running: 'Folding the context of',
    runningAlone: "Folding an agent's context",
    done: 'Folded the context of',
    doneAlone: "Folded an agent's context",
  },
  read_models: { running: 'Reading the models', done: 'Read the models' },
} satisfies Record<string, ToolWords>;
