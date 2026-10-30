import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import type { ServedModels } from '$lib/features/providers/served.js';
import { proofWords } from '../external/proofs.js';

export type HarnessFieldWords = {
  readonly value: string | null;
  readonly current: boolean;
  readonly detail: string;
};

export type HarnessWords = {
  readonly label: string;
  readonly model: HarnessFieldWords;
  readonly effort: HarnessFieldWords;
  readonly short: string | null;
};

type HarnessField = HarnessRowDetail['observation']['metadata']['model'];

function fieldWords(field: HarnessField, current: string | null): HarnessFieldWords {
  if (current !== null) {
    const detail = field._tag === 'Value' ? `${field.source} · ${field.claim} · ${field.observedAt}` : 'current';
    return { value: current, current: true, detail };
  }
  switch (field._tag) {
    case 'NotRead':
      return { value: null, current: false, detail: 'unread' };
    case 'Value':
      return { value: field.value, current: false, detail: `last known · ${field.source} · ${field.claim}` };
    case 'Absent':
      return { value: null, current: false, detail: 'unset' };
    case 'Unsupported':
      return { value: null, current: false, detail: 'unsupported' };
    case 'Unreadable': {
      const last = field.lastKnown;
      if (last === null) return { value: null, current: false, detail: `unreadable: ${field.reason}` };
      return { value: last.value, current: false, detail: `unreadable: ${field.reason} · last known ${last.value}` };
    }
    case 'Stale': {
      const last = field.lastKnown;
      const from = last.source === null ? '' : ` from ${last.source}`;
      const at = last.observedAt === null ? '' : ` · ${last.observedAt}`;
      return { value: last.value, current: false, detail: `last known${from} · ${last.why}${at}` };
    }
  }
}

function askedWords(asked: string, reported: HarnessFieldWords): HarnessFieldWords {
  const said = reported.value === null ? reported.detail : `${reported.value} · ${reported.detail}`;
  return { value: asked, current: true, detail: `asked · CLI reported ${said}` };
}

export function harnessWords(models: ServedModels, harness: HarnessRowDetail): HarnessWords {
  const model = fieldWords(harness.observation.metadata.model, harness.model);
  const effort = fieldWords(harness.observation.metadata.effort, harness.effort);
  const asked = harness.asked ?? null;
  const rung = asked?.reasoning ?? null;
  const unknown = model.value === null && ['NotRead', 'Absent'].includes(harness.observation.metadata.model._tag);
  const shown =
    asked !== null
      ? askedWords(asked.model, model)
      : unknown
        ? { value: 'CLI default', current: false, detail: 'Tagma named no model; the CLI runs on its own default until it reports one' }
        : model;
  const option = shown.value === null ? undefined : models.modelsFor(harness.provider, 'text').find((entry) => entry.id === shown.value);
  return {
    label: harness.presentation.label,
    model: shown,
    effort: rung === null ? effort : askedWords(rung, effort),
    short: shown.value === null ? null : (option?.short ?? shown.value),
  };
}

export type ModelWords = {
  readonly provider: string;
  readonly model: { readonly short: string; readonly label: string };
  readonly rung: { readonly id: string; readonly short: string; readonly label: string } | null;
  readonly providerLabel: string;
};

type Selection = { readonly provider: string; readonly model: string | null; readonly reasoning: string | null };

export function selectionOf(row: ThreadListRow): Selection {
  return row.life === 'working' && row.activeRunSelection !== null && row.activeRunSelection.provider !== null
    ? { provider: row.activeRunSelection.provider, model: row.activeRunSelection.model, reasoning: row.activeRunSelection.reasoning }
    : { provider: row.provider, model: row.model, reasoning: row.reasoning };
}

export function sameSelection(models: ServedModels, row: ThreadListRow, other: ThreadListRow): boolean {
  if (row.harness !== null || other.harness !== null) {
    if (row.harness === null || other.harness === null || row.harness.name !== other.harness.name) return false;
    const mine = harnessWords(models, row.harness);
    const theirs = harnessWords(models, other.harness);
    return mine.model.value !== null && mine.model.value === theirs.model.value && mine.effort.value === theirs.effort.value;
  }
  const mine = selectionOf(row);
  const theirs = selectionOf(other);
  return mine.provider === theirs.provider && mine.model === theirs.model && mine.reasoning === theirs.reasoning;
}

export function modelWords(models: ServedModels, row: ThreadListRow): ModelWords {
  const selection = selectionOf(row);
  const option = models.modelsFor(selection.provider, 'text').find((entry) => entry.id === selection.model);
  const id = selection.model ?? selection.provider;
  const rung =
    selection.reasoning === null
      ? null
      : (option?.reasoningOptions.find((entry) => entry.id === selection.reasoning) ?? {
          id: selection.reasoning,
          short: selection.reasoning,
          label: selection.reasoning,
        });
  return {
    provider: selection.provider,
    model: option ? { short: option.short, label: option.label } : { short: id, label: id },
    rung,
    providerLabel: models.providerLabel(selection.provider),
  };
}

export function modelIdentity(models: ServedModels, row: ThreadListRow): string {
  if (row.harness !== null) {
    const harness = harnessWords(models, row.harness);
    const model = harness.model.value === null ? null : harness.model.current ? harness.model.value : `${harness.model.value} (last known)`;
    const effort =
      harness.effort.value === null ? null : harness.effort.current ? harness.effort.value : `${harness.effort.value} (last known)`;
    return [harness.label, model, effort, proofWords(row.harness)?.label ?? null]
      .filter((part): part is string => part !== null)
      .join(' · ');
  }
  const words = modelWords(models, row);
  return [row.parentThreadId === null ? null : row.profileId, words.model.label, words.rung?.label, words.providerLabel]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
