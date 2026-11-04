/// <reference types="bun" />

import type { ProcessProbe, ProcessReading, ProcessRow } from '../ProcessReader';
import type { UsageDemand, UsageRead } from '../UsageReader';
import type { ProcessAbi } from './ProcessAbi';
import type { Refused } from './refusal';

export type Question =
  | { readonly _tag: 'Usage'; readonly demand: UsageDemand }
  | { readonly _tag: 'Scan'; readonly probe: ProcessProbe }
  | { readonly _tag: 'Facts'; readonly pids: ReadonlyArray<number> };

export type Request =
  | { readonly _tag: 'Open'; readonly path: string }
  | { readonly _tag: 'Ask'; readonly id: number; readonly question: Question };

export type Answer =
  | { readonly _tag: 'Ready' }
  | { readonly _tag: 'Opened'; readonly machineName: string }
  | { readonly _tag: 'Refused'; readonly detail: string }
  | { readonly _tag: 'Usage'; readonly id: number; readonly reply: UsageRead }
  | { readonly _tag: 'Scan'; readonly id: number; readonly reply: ReadonlyArray<ProcessRow> | Refused }
  | { readonly _tag: 'Facts'; readonly id: number; readonly reply: ProcessReading | Refused }
  | { readonly _tag: 'Failed'; readonly id: number; readonly detail: string };

type ProcessSource = {
  readonly processes: ProcessAbi;
  readonly sampler: {
    readonly machineName: string;
    readonly read: (demand: UsageDemand) => UsageRead | string;
  };
};

declare const self: Worker;

const send = (answer: Answer): void => self.postMessage(answer);

const answered = (opened: ProcessSource, id: number, question: Question): Answer => {
  switch (question._tag) {
    case 'Usage': {
      const read = opened.sampler.read(question.demand);
      return typeof read === 'string' ? { _tag: 'Failed', id, detail: read } : { _tag: 'Usage', id, reply: read };
    }
    case 'Scan':
      return { _tag: 'Scan', id, reply: opened.processes.processTable(question.probe) };
    case 'Facts':
      return { _tag: 'Facts', id, reply: opened.processes.processFacts(question.pids) };
  }
};

export const serveProcesses = (open: (path: string) => ProcessSource): void => {
  let opened: ProcessSource | undefined;

  self.onmessage = (event: MessageEvent<Request>) => {
    const request = event.data;
    if (request._tag === 'Open') {
      try {
        opened = open(request.path);
        send({ _tag: 'Opened', machineName: opened.sampler.machineName });
      } catch (error) {
        send({ _tag: 'Refused', detail: String(error) });
      }
      return;
    }
    if (opened === undefined) return send({ _tag: 'Failed', id: request.id, detail: 'the process worker was not opened' });
    try {
      send(answered(opened, request.id, request.question));
    } catch (error) {
      send({ _tag: 'Failed', id: request.id, detail: String(error) });
    }
  };

  send({ _tag: 'Ready' });
};
