import { getContext, setContext } from 'svelte';
import type { AgentCallEnding, AgentChildUpdate, AgentCommandEnding, AgentHook, AgentThreadEvent } from '@runlith/agent/contracts';
import type { CallEndingCount, ChildUpdateCount, CommandEndingCount, ThreadEventCount } from './notices';
import type { RunEndStatus, WordsWait } from '@runlith/agent/transcript/live';
import type { ChatLiveStatus } from './liveStatus';

export type ChatStrings = {
  readonly locale: string;

  thinking(): string;
  thought(): string;
  worked(): string;
  workedFor(duration: string): string;
  stepsCount(count: number): string;
  thoughtsCount(count: number): string;
  failed(): string;
  interrupted(): string;
  characters(count: number): string;
  refused(): string;
  failedCount(count: number): string;
  cancelled(): string;
  guidance(): string;
  guidanceAt(hook: AgentHook, toolName: string | null): string;
  livePhase(phase: ChatLiveStatus['phase'], waiting: ChatLiveStatus['waiting']): string;
  feedAsOf(time: string): string;
  feedRetrying(): string;
  copyDetails(): string;
  runTime(): string;
  launchTime(): string;
  waited(): string;
  waitedAfter(duration: string, calls: string): string;
  runEnding(status: RunEndStatus, duration: string): string;
  queuedCalls(count: number): string;
  queued(): string;
  outcomeUnknown(): string;
  stateUnknown(): string;
  retryingIn(duration: string): string;

  toolRunning(toolName: string): string;
  toolRunningAlone(toolName: string): string | null;
  toolDone(toolName: string): string;
  toolDoneAlone(toolName: string): string | null;
  toolUnknown(toolName: string): string;
  toolDoneCount(toolName: string, count: number): string;

  signal(signalType: string, sender: boolean): string;
  wordsFrom(intent: string): string | null;
  wordsUnconfirmed(): string;
  childUpdates(counts: readonly ChildUpdateCount[]): string;
  childUpdate(update: AgentChildUpdate): string;
  callEndings(counts: readonly CallEndingCount[]): string;
  callEnding(ending: AgentCallEnding): string;
  commandEndings(counts: readonly CommandEndingCount[]): string;
  commandEnding(ending: AgentCommandEnding): string;
  commandExit(exit: NonNullable<AgentCommandEnding['exit']>): string;
  noOutput(): string;
  outputUnread(): string;
  threadEvents(counts: readonly ThreadEventCount[]): string;
  threadEvent(event: AgentThreadEvent): string;
  childContext(tokens: string): string;
  childCache(kind: 'cold' | 'likely-warm' | 'estimated-cold'): string;
  warmTill(time: string): string;
  yourWords(): string;

  openingThread(): string;
  threadUnreadable(): string;
  unknownEntry(kind: string): string;
  unreadableEntry(kind: string): string;

  context(): string;
  systemPrompt(): string;

  jumpToLatest(): string;
  messageNavigation(): string;
  prompt(): string;
  imagePrompt(): string;
  attachmentsCount(count: number): string;

  copy(): string;
  copyReport(): string;
  details(): string;
  copyMessage(): string;
  unconfirmedTurn(): string;
  sendingAnswer(): string;
  forgetTurn(): string;
  resendTurn(): string;
  showLess(): string;
  showAll(): string;
  showDetails(): string;
  lineCount(count: number): string;
  open(): string;
  copyAddress(): string;
  openThread(): string;
  openFile(path: string): string;
  andMore(count: number): string;
  toolInput(): string;
  toolOutput(): string;
  assistantError(): string;
  interruptedByUser(): string;
  restarted(by: 'you' | 'agent', stopped: boolean): string;
  restartWaits(): string;
  restartClosed(toolNames: readonly string[]): string;
  compacting(summarizer: string | null): string;
  compacted(summarizer: string | null): string;
  alreadyCompact(): string;
  stopped(): string;
  auto(): string;
  manual(): string;
  measured(): string;
  projected(): string;
  budget(): string;
  cacheRead(): string;
  cacheWritten(): string;
  retry(): string;
  retryReason(family: string): string;
  quickReplies(): string;
  repliedInChat(): string;
  fromAgent(): string;
  document(): string;
  documentLowercase(): string;
  documentsCount(count: number): string;
  attached(): string;
  image(): string;
  attachment(): string;
  copyImage(): string;
  saveImage(): string;
  close(): string;

  confirmation(): string;
  confirm(): string;
  confirmAll(): string;
  cancel(): string;
  showMoreFacts(count: number): string;
  noAnswerSubmitted(): string;
  askedOf(approver: string | null): string;
  decidedBy(by: string, note: string | undefined): string;
  typeYourAnswer(): string;
  done(): string;

  promptPlaceholder(): string;
  send(): string;
  steerTurn(): string;
  typeMessageToSend(): string;
  attachFiles(): string;
  removeNamed(name: string): string;
  stop(): string;
  stopping(): string;
  beingStopped(): string;
  nothingToAttach(): string;
  goBack(): string;
  current(): string;
  nothingToPick(): string;
  noCommandsFound(): string;
  verboseDescription(): string;
  stretchesDescription(): string;
  on(): string;
  off(): string;

  waitingNextStep(): string;
  waitingAfterTurn(): string;
  agentReadsNext(): string;
  stopAndSendNow(): string;
  wordsWait(reason: WordsWait): string;
  moreWaiting(count: number): string;
  sendAtNextStep(): string;
  editInField(): string;
  sendAfterTurn(): string;
  whenToSend(): string;
  runningPlaceholder(): string;
  hintNextStep(): string;
  hintAfterTurn(): string;
  compactionPending(): string;
  compactionKeeping(): string;
  delete(): string;

  contextUsage(): string;
  contextCompactsAt(share: string, window: string): string;
  contextWindowUnknown(): string;
  contextUsed(): string;
  contextTokensUsed(used: string, total: string): string;
  contextEstimated(): string;
  contextNextRequest(tokens: string): string;
  contextStaleSince(lastMeasured: string): string;
  tokens(): string;
  lessThanOnePercent(): string;
  contextInput(): string;
  contextOutput(): string;
  contextReasoning(): string;
  contextCacheRead(): string;
  contextCacheWrite(): string;
  contextTotal(): string;
};

const CONTEXT = Symbol.for('runlith.chat-ui.strings');

export function provideChatStrings(strings: ChatStrings): void {
  setContext(CONTEXT, strings);
}

export function useChatStrings(): ChatStrings {
  const strings = getContext<ChatStrings | undefined>(CONTEXT);
  if (!strings) throw new Error('Chat strings context is not available.');
  return strings;
}
