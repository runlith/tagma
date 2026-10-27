import { OPERATIONS, type CatalogOperationId } from '@tagma/server/composition/catalog';
import { toolPresentation as presentationOf } from '@tagma/server/native-harness/tools/presentation';
import type { ToolWords } from '@runlith/agent/tool/words';
import { mcpToolNamed } from '@runlith/mcp/identity';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { AGENT_CHILD_UPDATE_SIGNAL_TYPE, THREAD_EVENT_SIGNAL_TYPE } from '@runlith/agent/contracts';
import { CALL_RESULT_SIGNAL } from '@tagma/server/threads/contract/wire/calls';
import { COMMAND_RESULT_SIGNAL } from '@tagma/server/executions/contract/wire/commands';
import type { ChatRewindWords } from '@runlith/chat-ui/rewind';
import type { ChatStrings } from '@runlith/chat-ui/strings';
import { queuedCalls, waitingWords } from '../workWords.js';

const operationWords = (toolName: string): ToolWords | undefined =>
  Object.hasOwn(OPERATIONS, toolName) ? OPERATIONS[toolName as CatalogOperationId].presentation : undefined;

const toolPresentation = (toolName: string) => presentationOf(toolName, operationWords);

const toolLabel = (toolName: string): string => {
  const server = mcpToolNamed(toolName);
  return server === null ? toolName.replaceAll('_', ' ') : `${server.tool} on ${server.server}`;
};

export function activityWords(): Pick<
  ChatStrings,
  | 'livePhase'
  | 'queuedCalls'
  | 'queued'
  | 'outcomeUnknown'
  | 'stateUnknown'
  | 'toolDone'
  | 'toolDoneAlone'
  | 'toolRunning'
  | 'toolRunningAlone'
  | 'toolUnknown'
> {
  return {
    livePhase: (phase, waiting) =>
      (phase === 'opening' && waiting !== null ? waitingWords(waiting) : null) ??
      {
        opening: 'Preparing the next step',
        preparing: 'Preparing the next step',
        calling: 'Thinking',
        reasoning: 'Thinking',
        writing: 'Writing',
        tools: 'Preparing calls',
        compacting: 'Compacting the context',
        retrying: 'Waiting to retry',
        working: 'Working',
        awaiting: 'Waiting for your answer',
        unresponsive: 'Run is not responding',
        reconnecting: 'Reconnecting',
        unreadable: 'Thread is not showing',
      }[phase],
    queuedCalls,
    queued: () => 'queued',
    outcomeUnknown: () => 'outcome unknown',
    stateUnknown: () => 'state unknown',
    toolRunning: (toolName) => toolPresentation(toolName).running,
    toolRunningAlone: (toolName) => toolPresentation(toolName).runningAlone ?? null,
    toolDone: (toolName) => toolPresentation(toolName).done,
    toolDoneAlone: (toolName) => toolPresentation(toolName).doneAlone ?? null,
    toolUnknown: toolLabel,
  };
}

const SIGNAL_LINES: Readonly<Record<string, string>> = {
  [KEEP_WARM_SIGNAL_TYPE]: 'Kept warm',
  [AGENT_CHILD_UPDATE_SIGNAL_TYPE]: 'Child update',
  [THREAD_EVENT_SIGNAL_TYPE]: 'Thread event',
  [CALL_RESULT_SIGNAL]: 'Background call ended',
  [COMMAND_RESULT_SIGNAL]: 'Command ended',
};

function signalLine(signalType: string, sender: boolean): string {
  const known = SIGNAL_LINES[signalType];
  if (known !== undefined) return known;
  const named = signalType.replaceAll('-', ' ');
  const word = `${named.charAt(0).toUpperCase()}${named.slice(1)}`;
  return sender ? `${word} from` : word;
}

function wordsLead(intent: string): string | null {
  switch (intent) {
    case 'message':
    case 'agent-message':
      return null;
    case 'task':
      return 'Task from';
    case 'report':
      return 'Report from';
    case 'interrupt':
      return 'Interrupted by';
    case 'approval':
      return 'Approval asked by';
    default:
      return `${intent.replaceAll('-', ' ')} from`;
  }
}

const CHILD_EVENTS = {
  ran: 'finished',
  compacted: 'compacted',
  cooled: 'cooled',
  'model-changed': 'changed model',
  tasks: 'left tasks for you',
} as const;

const CALL_OUTCOMES = { completed: 'finished', failed: 'failed', stopped: 'was stopped', interrupted: 'was interrupted' } as const;

const COMMAND_ENDINGS = { completed: 'finished', stopped: 'stopped', expired: 'ran out of life', unknown: 'ended' } as const;

const THREAD_EVENTS = {
  rested: 'came to rest',
  failed: 'failed',
  stalled: 'stalled',
  awaiting: 'waits for you',
  'addresses-human': 'asks a human',
  stopped: 'was stopped by you',
  committed: 'committed',
  'task-closed': 'closed a task',
} as const;

const RETRY_REASONS: Readonly<Record<string, string>> = {
  'torn-stream': 'connection dropped',
  'socket-closed': 'connection closed',
  'clean-eof-no-finish': 'answer cut short',
  'blank-error': 'provider error',
  'rate-limit': 'rate limit',
  overloaded: 'provider busy',
  stalled: 'no response',
  dns: 'network',
  tls: 'network',
  reset: 'network',
  'connect-timeout': 'network',
  unknown: 'network',
};

export function nativeStrings(): ChatStrings {
  return {
    locale: 'en',

    thinking: () => 'Thinking',
    thought: () => 'Thought',
    worked: () => 'Worked',
    workedFor: (duration) => `Worked for ${duration}`,
    stepsCount: (count) => `${count} ${count === 1 ? 'step' : 'steps'}`,
    thoughtsCount: (count) => `${count} thoughts`,
    failed: () => 'Failed',
    interrupted: () => 'Cut off',
    characters: (count) => `${count.toLocaleString('en-US')} characters`,
    refused: () => 'Refused',
    failedCount: (count) => `${count} failed`,
    cancelled: () => 'Cancelled',
    guidance: () => 'Guidance',
    guidanceAt: (hook, toolName) =>
      ({
        beforeStep: 'before the step',
        beforeTool: `before ${toolName ?? 'a call'}`,
        afterTool: `after ${toolName ?? 'a call'}`,
        beforeClose: 'before the run ends',
      })[hook],
    runTime: () => 'Run time',
    feedAsOf: (time) => `as of ${time}`,
    feedRetrying: () => 'Still trying to read it',
    copyDetails: () => 'Copy details',
    launchTime: () => 'launch',
    waited: () => 'waited',
    waitedAfter: (duration, calls) => `${duration} after ${calls}`,
    runEnding: (status, duration) =>
      `${{ completed: 'Finished in', failed: 'Failed after', aborted: 'Stopped after', cut: 'Interrupted after' }[status]} ${duration}`,
    retryingIn: (duration) => `Retrying in ${duration}`,

    ...activityWords(),
    signal: (signalType, sender) => signalLine(signalType, sender),
    wordsFrom: (intent) => wordsLead(intent),
    wordsUnconfirmed: () => 'Not confirmed: the agent may have read these words, but never said so.',
    childUpdates: (counts) =>
      counts
        .map(({ event, count }, index) => {
          const who = index > 0 ? String(count) : count === 1 ? 'Agent' : `${count} agents`;
          return `${who} ${CHILD_EVENTS[event]}`;
        })
        .join(', '),
    childUpdate: (update) =>
      update.event === 'model-changed'
        ? `changed model ${update.from.provider}/${update.from.model ?? 'default'} ${update.from.reasoning ?? 'default'} → ${update.to.provider}/${update.to.model ?? 'default'} ${update.to.reasoning ?? 'default'}`
        : update.event === 'ran'
          ? update.forOperator
            ? 'answered you'
            : 'finished its turn'
          : update.event === 'compacted'
            ? 'compacted its context'
            : update.event === 'tasks'
              ? 'left tasks for you'
              : 'went cold',
    callEndings: (counts) =>
      counts
        .map(({ tool, outcome, count }) =>
          tool === 'spawn_agent' && outcome === 'completed'
            ? count === 1
              ? 'Agent started'
              : `${count} agents started`
            : `${count === 1 ? tool : `${count} × ${tool}`} ${CALL_OUTCOMES[outcome]} in the background`,
        )
        .join(', '),
    callEnding: (ending) => `${ending.tool} ${CALL_OUTCOMES[ending.outcome]}`,
    commandEndings: (counts) => {
      const total = counts.reduce((sum, { count }) => sum + count, 0);
      const [only] = counts;
      if (counts.length === 1 && only !== undefined) {
        return total === 1 ? `Command ${COMMAND_ENDINGS[only.ending]}` : `${total} commands ${COMMAND_ENDINGS[only.ending]}`;
      }
      return `${total} commands ended`;
    },
    commandEnding: (ending) => `Command ${COMMAND_ENDINGS[ending.ending]}`,
    commandExit: (exit) => (exit.kind === 'code' ? `exit ${exit.code}` : exit.signal),
    noOutput: () => 'No output',
    outputUnread: () => 'The output could not be read',
    threadEvents: (counts) =>
      counts
        .map(({ event, count }, index) => {
          const who = index > 0 ? String(count) : count === 1 ? 'Thread' : `${count} threads`;
          return `${who} ${THREAD_EVENTS[event]}`;
        })
        .join(', '),
    threadEvent: (notice) => THREAD_EVENTS[notice.event],
    childContext: (tokens) => `${tokens} context`,
    childCache: (kind) => ({ cold: 'cold', 'likely-warm': 'likely warm', 'estimated-cold': 'likely cold' })[kind],
    warmTill: (time) => `warm till ${time}`,
    yourWords: () => 'your words',
    toolDoneCount: (toolName, count) => {
      const presentation = toolPresentation(toolName);
      return presentation.many?.(count) ?? `${presentation.done} ${count} times`;
    },

    openingThread: () => 'Opening this thread',
    threadUnreadable: () => 'This thread could not be read',
    unknownEntry: (kind) => `No renderer for entry kind ${kind}`,
    unreadableEntry: (kind) => `An entry of kind ${kind} cannot be read by this app`,

    context: () => 'Graph',
    systemPrompt: () => 'System prompt',

    jumpToLatest: () => 'Jump to latest',
    messageNavigation: () => 'Message navigation',
    prompt: () => 'Prompt',
    imagePrompt: () => 'Image prompt',
    attachmentsCount: (count) => `${count} ${count === 1 ? 'attachment' : 'attachments'}`,

    copy: () => 'Copy',
    copyReport: () => 'Copy report',
    details: () => 'Details',
    copyMessage: () => 'Copy message',
    unconfirmedTurn: () => 'Not confirmed: the server has not answered.',
    sendingAnswer: () => 'Sending your answer',
    forgetTurn: () => 'Remove and return to draft',
    resendTurn: () => 'Send again',
    showLess: () => 'Show less',
    showAll: () => 'Show all',
    showDetails: () => 'Show details',
    lineCount: (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'line' : 'lines'}`,
    open: () => 'Open',
    copyAddress: () => 'Copy address',
    openThread: () => 'Open thread',
    openFile: (path) => `Open ${path}`,
    andMore: (count) => `and ${count} more`,
    toolInput: () => 'Input',
    toolOutput: () => 'Output',
    assistantError: () => 'Turn failed',
    interruptedByUser: () => 'Interrupted',
    restarted: (by, stopped) => {
      const act = stopped ? 'stopped the turn and restarted the agent' : 'restarted the agent';
      return by === 'you' ? `You ${act}` : act;
    },
    restartWaits: () => 'The turn was stopped and continues with the next message',
    restartClosed: (toolNames) => `Closed ${toolNames.map(toolLabel).join(', ')}`,
    compacting: (summarizer) => (summarizer === null ? 'Compacting the context' : `Compacting the context with ${summarizer}`),
    compacted: (summarizer) => (summarizer === null ? 'Compacted the context' : `Compacted the context with ${summarizer}`),
    alreadyCompact: () => 'unchanged',
    stopped: () => 'stopped',
    auto: () => 'automatic',
    manual: () => 'manual',
    measured: () => 'measured',
    projected: () => 'projected',
    budget: () => 'budget',
    cacheRead: () => 'read from cache',
    cacheWritten: () => 'written to cache',
    retry: () => 'Retried',
    retryReason: (family) => RETRY_REASONS[family] ?? family.replaceAll('-', ' '),
    quickReplies: () => 'Quick replies',
    repliedInChat: () => 'Replied in chat',
    fromAgent: () => 'From the agent',
    document: () => 'Document',
    documentLowercase: () => 'document',
    documentsCount: (count) => `${count} ${count === 1 ? 'document' : 'documents'}`,
    attached: () => 'Attached',
    image: () => 'Image',
    attachment: () => 'Attachment',
    copyImage: () => 'Copy image',
    saveImage: () => 'Save image…',
    close: () => 'Close',

    confirmation: () => 'Confirm',
    confirm: () => 'Confirm',
    confirmAll: () => 'Confirm all',
    cancel: () => 'Cancel',
    showMoreFacts: (count) => `${count} more`,
    noAnswerSubmitted: () => 'No answer submitted',
    askedOf: (approver) => (approver === null ? 'Asking you' : `Asking thread ${approver}, which answers for its team instead of you`),
    decidedBy: (by, note) => `Answered by thread ${by} instead of you${note === undefined ? '' : `: ${note}`}`,
    typeYourAnswer: () => 'Type your answer',
    done: () => 'Done',

    promptPlaceholder: () => 'Ask anything, / for commands, $ for skills',
    send: () => 'Send',
    steerTurn: () => 'Send — the running turn reads it at its next step',
    typeMessageToSend: () => 'Type a message to send',
    attachFiles: () => 'Attach images or PDFs',
    removeNamed: (name) => `Remove ${name}`,
    stop: () => 'Stop',
    stopping: () => 'Stopping…',
    beingStopped: () => 'Being stopped',
    nothingToAttach: () => 'Nothing to attach',
    goBack: () => 'to go back',
    current: () => 'Current',
    nothingToPick: () => 'Nothing to pick',
    noCommandsFound: () => 'No commands found',
    verboseDescription: () => 'Show raw payloads and transport rows',
    stretchesDescription: () => 'Keep every worked group open; nothing folds by itself',
    on: () => 'On',
    off: () => 'Off',

    waitingNextStep: () => 'Next step',
    waitingAfterTurn: () => 'After this turn',
    agentReadsNext: () => 'Agent reads next',
    stopAndSendNow: () => 'stop and send now',
    wordsWait: (reason) =>
      ({
        archived: 'Waiting: the thread is archived',
        'launch-refused': 'Waiting: the agent could not start',
        'words-unsettled': 'Waiting for earlier words to settle',
        'composer-draft': 'Waiting: the agent’s input has an unsent draft',
      })[reason],
    moreWaiting: (count) => `${count} more`,
    sendAtNextStep: () => 'Send at the next step',
    editInField: () => 'Edit in the field',
    sendAfterTurn: () => 'Send after this turn',
    whenToSend: () => 'When to send',
    runningPlaceholder: () => 'Return sends at the next step, Tab after this turn',
    hintNextStep: () => 'next step',
    hintAfterTurn: () => 'after this turn',
    compactionPending: () => 'Compact context',
    compactionKeeping: () => 'keep:',
    delete: () => 'Delete',

    contextUsage: () => 'Context',
    contextCompactsAt: (share, window) => `Compacts at ${share} of the ${window} window`,
    contextWindowUnknown: () => 'Context window unknown',
    contextUsed: () => 'used',
    contextTokensUsed: (used, total) => `${used} of ${total}`,
    contextNextRequest: (tokens: string) => `Next request ~${tokens}`,
    contextEstimated: () => 'Estimated until the next reply',
    contextStaleSince: (lastMeasured) => `Context changed, last measured ${lastMeasured} tokens`,
    tokens: () => 'tokens',
    lessThanOnePercent: () => '<1%',
    contextInput: () => 'Input',
    contextOutput: () => 'Output',
    contextReasoning: () => 'Reasoning',
    contextCacheRead: () => 'Cache read',
    contextCacheWrite: () => 'Cache write',
    contextTotal: () => 'Total',
  };
}

const turns = (count: number) => `${count} ${count === 1 ? 'turn' : 'turns'}`;

export const rewindWords: ChatRewindWords = {
  rewindHere: () => 'Rewind here',
  rewindHint: () => 'Take this turn and every later one out of the model’s context, and return this message to the composer for editing',
  branch: () => 'Branch',
  branchHint: () => 'Start a new thread that ends right before this message, with the message in its composer',
  dropTurn: () => 'Drop turn',
  dropHint: () => 'Take only this turn out of the model’s context; later turns stay',
  messageActions: () => 'Message actions',
  rewoundTurns: (count) => `Rewound ${turns(count)}`,
  unseen: () => 'the model no longer sees them',
  dropped: () => 'dropped from the context',
  wordless: () => 'a turn without words',
  show: () => 'Show',
  hide: () => 'Hide',
  restore: () => 'Restore',
  rewoundTo: (ordinal) => `rewound to message ${ordinal}`,
  pickerTitle: () => 'Rewind to a message',
  pickRewind: () => 'rewind',
  pickBranch: () => 'branch',
  pickClose: () => 'close',
  turnFailed: () => 'failed',
  turnSteps: (count) => `${count} ${count === 1 ? 'step' : 'steps'}`,
  turnAnswered: () => 'answered',
};
