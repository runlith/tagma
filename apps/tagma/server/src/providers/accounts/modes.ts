import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid, type CredentialFileFault } from '@runlith/credential-file/failure';
import type { Provider } from '@runlith/tagma/adapter/provider';
import type { SignedProviders } from '../contract/service/registry.js';
import { Effect, Result, Schema } from 'effect';
import type { AccountCli, ProgramState } from '../contract/service/cli.js';
import type { AccountSection } from '../contract/wire/catalog.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

const selections = Schema.Record(Schema.String, Schema.String);

export const makeAccountModes = (input: { readonly path: string; readonly cli: AccountCli['Service'] }) => {
  const { path, cli } = input;

  const file = makeCredentialFile<typeof selections.Type>({
    path,
    codec: {
      empty: () => ({}),
      decode: (path, parsed) =>
        Schema.decodeUnknownEffect(selections)(parsed).pipe(
          Effect.map((value) => ({ value, needsWrite: false })),
          Effect.mapError((cause) => new CredentialFileInvalid({ path, reason: cause.message })),
        ),
    },
  });

  const resolve = Effect.fnUntraced(function* (providers: readonly Provider[], signed: SignedProviders | null) {
    const sections = yield* modeSections(providers, cli);
    const read = yield* Effect.result(file.read());
    if (Result.isFailure(read)) return sections.map((section) => ({ ...section, failure: read.failure.message }));
    const kept = read.success;
    const missing = sections.filter((section) => kept[section.id] === undefined && section.options.length > 1);
    const settled = missing.length === 0 || signed === null ? null : yield* settle(missing, signed);
    const failure = settled !== null && 'failure' in settled ? settled.failure : undefined;
    const chosen = settled !== null && 'first' in settled ? { ...settled.first, ...kept } : kept;
    return sections.map((section) => {
      const selected = chosen[section.id] ?? section.selected;
      return {
        ...section,
        selected: section.options.some((option) => option.id === selected) ? selected : section.selected,
        failure: missing.includes(section) ? failure : undefined,
      };
    });
  });
  const settle = Effect.fnUntraced(function* (missing: readonly AccountSection[], signed: SignedProviders) {
    const held = yield* Effect.result(signed);
    if (Result.isFailure(held)) return { failure: held.failure.message };
    const owned = new Set(held.success);
    const first = Object.fromEntries(
      missing
        .filter(
          (section) =>
            section.options[0]?.unavailable === null ||
            section.options.some((option) => option.unavailable === null && owned.has(option.provider)),
        )
        .map((section) => [section.id, section.options.find((option) => owned.has(option.provider))?.id ?? section.selected]),
    );
    const written = yield* Effect.result(file.update((current) => Effect.succeed({ ...first, ...current })));
    return Result.isFailure(written) ? { failure: written.failure.message } : { first };
  });
  const select = (
    sections: readonly AccountSection[],
    id: string,
    mode: string,
  ): Effect.Effect<void, CredentialFileFault | GateRefusal> => {
    const section = sections.find((section) => section.id === id);
    const option = section?.options.find((option) => option.id === mode);
    if (option === undefined)
      return Effect.fail(new GateRefusal('unknown-mode', `No account mode ${mode} is declared for ${id}.`, ['read the provider catalog']));
    if (option.unavailable !== null) return Effect.fail(new GateRefusal('mode-unavailable', option.unavailable, ['install its CLI']));
    return file.update((kept) => Effect.succeed({ ...kept, [id]: mode }));
  };
  return { resolve, select };
};
export type AccountModes = ReturnType<typeof makeAccountModes>;

export const modeSections = Effect.fn('providers.modeSections')(function* (providers: readonly Provider[], cli?: AccountCli['Service']) {
  const groups = new Map<string, { title: string; preferred: string; options: AccountSection['options'][number][] }>();
  const installed = new Map<string, ProgramState>();
  for (const provider of providers) {
    const mode = provider.accountMode;
    if (mode === undefined) continue;
    let unavailable: string | null = null;
    if (provider.kind === 'harness' && provider.auth === 'cli' && provider.accounts !== undefined && cli !== undefined) {
      const program = provider.accounts.login.program;
      let state = installed.get(program);
      if (state === undefined) {
        state = yield* cli.installed(program);
        installed.set(program, state);
      }
      if (state._tag === 'Searching') unavailable = `Looking for ${program}…`;
      if (state._tag === 'Missing') unavailable = `${mode.missing ?? `${program} isn't installed`}: ${state.reason}`;
    }
    let group = groups.get(mode.section);
    if (group === undefined) {
      group = { title: mode.title, preferred: mode.default, options: [] };
      groups.set(mode.section, group);
    }
    group.options.push({
      id: mode.id,
      label: mode.label,
      hint: mode.hint,
      provider: provider.id,
      unavailable,
      signInLabel: mode.signInLabel,
      defaultPlace: mode.defaultPlace,
    });
  }
  return Array.from(groups, ([id, group]) => {
    const preferred = group.options.find((option) => option.id === group.preferred && option.unavailable === null);
    const selected = preferred?.id ?? group.options.find((option) => option.unavailable === null)?.id ?? group.preferred;
    return {
      id,
      title: group.title,
      selected,
      options: group.options.sort((left, right) => Number(right.id === group.preferred) - Number(left.id === group.preferred)),
    };
  });
});

export const accountSource = (providers: readonly Provider[], sections: readonly AccountSection[], id: string): string => {
  const provider = providers.find((provider) => provider.id === id);
  if (provider?.kind !== 'wire' || provider.borrows === undefined || provider.accountMode === undefined) return id;
  const section = sections.find((section) => section.id === provider.accountMode!.section);
  const selected = section?.options.find((option) => option.id === section.selected)?.provider;
  return selected === provider.borrows.provider ? selected : id;
};
