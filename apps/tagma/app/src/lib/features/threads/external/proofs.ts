import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import type { HarnessTransport } from '@tagma/server/threads/contract/wire/harness/names';
import type { TransportCopy } from '@runlith/agent/thread/record';

export type ProofWords = { readonly label: string; readonly hint: string };

const RUNS = { acp: 'runs here as a chat', terminal: 'runs in its own terminal' } as const;

export const roadName = (transport: HarnessTransport): string => (transport === 'acp' ? 'Chat' : 'Terminal');

const RECORD = 'Tagma’s record of the conversation: its words, answers and calls, without its reasoning or full tool outputs';

const WHOLE: Readonly<Record<TransportCopy, string>> = {
  vendor: 'a fork of the whole thread is an exact copy',
  record: `a fork of the whole thread starts the CLI on ${RECORD}`,
  none: 'it cannot be forked whole',
};

const POINT: Readonly<Record<TransportCopy, string>> = {
  vendor: 'a rewind or branch at a turn is an exact copy',
  record: `a rewind or branch at a turn starts the CLI on ${RECORD}`,
  none: 'it cannot be rewound or branched at a turn',
};

function copyGap(capabilities: HarnessRowDetail['capabilities']): readonly [string, string] | null {
  const copies = capabilities.copies;
  if (capabilities.history === 'none' || copies === undefined) return null;
  const { whole, point } = copies;
  if (whole === 'record' && point === 'record') return ['history from record', `a fork, rewind or branch starts the CLI on ${RECORD}`];
  const label =
    point === 'record'
      ? 'turn cuts from record'
      : whole === 'record'
        ? 'forks from record'
        : point === 'none'
          ? 'no turn cuts'
          : whole === 'none'
            ? 'no whole fork'
            : null;
  return label === null ? null : [label, `${WHOLE[whole]}; ${POINT[point]}`];
}

function seededGap(harness: HarnessRowDetail): readonly [string, string] | null {
  const startedAt = harness.process?.startedAt ?? null;
  if (startedAt === null) return null;
  const seeded = harness.observation.diagnostics.findLast(
    (diagnostic) => diagnostic.cause === 'history-seeded' && Date.parse(diagnostic.at) >= Date.parse(startedAt),
  );
  return seeded === undefined
    ? null
    : ['session from record', `this CLI session started on ${RECORD} in place of an exact copy: ${seeded.detail.replace(/\.$/, '')}`];
}

export function proofWords(harness: HarnessRowDetail): ProofWords | null {
  const capabilities = harness.capabilities;
  const seeded = seededGap(harness);
  const copied = copyGap(capabilities);
  const gaps = [
    ...(seeded === null ? [] : [seeded]),
    ...(capabilities.law === 'asked-calls' ? [['asked calls only', 'Tagma’s law judges only the calls the agent asks about']] : []),
    ...(capabilities.touch === 'writes' ? [['reads unseen', 'the files it reads are not seen']] : []),
    ...(capabilities.authorship === 'observed' ? [['lines observed', 'the lines it writes are observed, not recorded']] : []),
    ...(copied === null ? [] : [copied]),
    ...(capabilities.feed === 'turns'
      ? [['turns only', 'its feed holds turns, calls and answers, without live text, reasoning or the calls made while Tagma was down']]
      : []),
    ...(capabilities.usage === 'partial'
      ? [['spend at turn end', 'its spend and context reading land when a turn ends']]
      : capabilities.usage === 'none'
        ? [['spend unmeasured', 'its spend is not measured, so neither is its budget']]
        : []),
    ...(capabilities.aside === 'none' ? [['no warm copy', 'this transport keeps no warm copy for a recap']] : []),
  ];
  const [first] = gaps;
  if (first === undefined) return null;
  return {
    label: `${roadName(harness.transport)} · ${first[0]}`,
    hint: `${harness.presentation.label} ${RUNS[harness.transport]}: ${gaps.map(([, said]) => said).join('; ')}.`,
  };
}
