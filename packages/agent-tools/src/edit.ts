import { dirname } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { Tool } from '@runlith/agent/tool';
import { ToolFailed } from '@runlith/agent/tool';
import { foreignCause, runToolEffect, unboundTool } from './ToolEdge';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, namedPath, pathClaims, pathPreparation, resolveToolOptions, withEntryWrite } from './workspace/runtime';
import { fileCode, displayPath, filePatch } from './display';
import { aliasRefusal, entryIdentity, orAbsent, storedOf } from './namespace';
import { inTurn, recording, recordedSentence } from './changed';
import { withoutAddedProse } from './prose';
import { DESCRIPTION_EDIT } from './descriptions';
import { REFUSALS, refused } from './refusals';
import { fileContent } from '@runlith/files/content';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

function normalizeLineEndings(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function convertToLineEnding(text: string, ending: '\n' | '\r\n'): string {
  if (ending === '\n') return text;
  return text.replaceAll('\n', '\r\n');
}

const editInputSchema = Schema.Struct({
  path: Schema.String.annotate({ description: 'The absolute path to the file to modify' }),
  oldString: Schema.String.annotate({ description: 'The text to replace' }),
  newString: Schema.String.annotate({
    description: 'The text to replace it with (must be different from oldString)',
  }),
  replaceAll: Schema.optional(Schema.Boolean.annotate({ description: 'Replace all occurrences of oldString (default false)' })),
});

type Params = typeof editInputSchema.Type;

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = (originalLines[i + j] as string).trim();
      const searchTrimmed = (searchLines[j] as string).trim();
      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) matchStartIndex += (originalLines[k] as string).length + 1;
      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += (originalLines[i + k] as string).length;
        if (k < searchLines.length - 1) matchEndIndex += 1;
      }
      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalizeWhitespace(find);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    } else {
      const normalizedLine = normalizeWhitespace(line);
      if (normalizedLine.includes(normalizedFind)) {
        const words = find.trim().split(/\s+/);
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
          try {
            const regex = new RegExp(pattern);
            const match = line.match(regex);
            if (match) yield match[0];
          } catch {}
        }
      }
    }
  }
  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
        yield block.join('\n');
      }
    }
  }
};

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return text;
    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/);
        return match ? (match[1] as string).length : 0;
      }),
    );
    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n');
  };
  const normalizedFind = removeIndentation(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (removeIndentation(block) === normalizedFind) yield block;
  }
};

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case "'":
          return "'";
        case '"':
          return '"';
        case '`':
          return '`';
        case '\\':
          return '\\';
        case '\n':
          return '\n';
        case '$':
          return '$';
        default:
          return match;
      }
    });
  };
  const unescapedFind = unescapeString(find);
  if (content.includes(unescapedFind)) yield unescapedFind;
  const lines = content.split('\n');
  const findLines = unescapedFind.split('\n');
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    const unescapedBlock = unescapeString(block);
    if (unescapedBlock === unescapedFind) yield block;
  }
};

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0;
  while (true) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) break;
    yield find;
    startIndex = index + find.length;
  }
};

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim();
  if (trimmedFind === find) return;
  if (content.includes(trimmedFind)) yield trimmedFind;
  const lines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    if (block.trim() === trimmedFind) yield block;
  }
};

export function trimDiff(diff: string): string {
  const lines = diff.split('\n');
  const contentLines = lines.filter(
    (line) => (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) && !line.startsWith('---') && !line.startsWith('+++'),
  );
  if (contentLines.length === 0) return diff;
  let min = Number.POSITIVE_INFINITY;
  for (const line of contentLines) {
    const content = line.slice(1);
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/);
      if (match) min = Math.min(min, (match[1] as string).length);
    }
  }
  if (min === Number.POSITIVE_INFINITY || min === 0) return diff;
  const trimmedLines = lines.map((line) => {
    if ((line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) && !line.startsWith('---') && !line.startsWith('+++')) {
      const prefix = line[0] as string;
      const content = line.slice(1);
      return prefix + content.slice(min);
    }
    return line;
  });
  return trimmedLines.join('\n');
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw refused('call-shape', 'No changes to apply: oldString and newString are identical.');
  }
  let notFound = true;
  matching: for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) {
        return content.split(search).join(newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) {
        if (replacer === SimpleReplacer) break matching;
        continue;
      }
      return content.substring(0, index) + newString + content.substring(index + search.length);
    }
  }
  if (notFound) {
    throw refused(
      'no-match',
      'Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.',
    );
  }
  throw refused('many-matches', 'Found multiple matches for oldString. Provide more surrounding context to make the match unique.');
}

const rewrittenNote = (
  resolved: ReturnType<typeof resolveToolOptions>,
  path: string,
  source: string,
  failure: ToolFailed,
): Effect.Effect<never, ToolFailed> => {
  const asked = resolved.changes?.rewrittenBy;
  if (asked === undefined) return Effect.fail(failure);
  return Effect.flatMap(asked(path, source), (rewrite) => {
    if (rewrite === null) return Effect.fail(failure);
    const by = rewrite.commit === null ? 'a commit' : `the commit ${rewrite.commit.slice(0, 10)}`;
    return Effect.fail(
      new ToolFailed({
        reason: `${failure.reason} The file was rewritten by ${by} (its steps or hooks); read it again.`,
        code: failure.code,
      }),
    );
  });
};

const run = Effect.fn('EditTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  prepared: PreparedPath | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  if (params.oldString === params.newString) {
    return yield* refused('call-shape', 'No changes to apply: oldString and newString are identical.');
  }
  const filePath = yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
  const identity = yield* entryIdentity(filePath);
  if (identity.kind === 'alias' || identity.kind === 'taken') {
    return yield* refused('aliased', aliasRefusal(resolved.cwd, filePath, storedOf(identity)));
  }
  if (params.oldString === '') {
    const before = yield* fileContent(fs, filePath).pipe(Effect.option);
    const existed = before._tag === 'Some';
    const source = existed ? before.value.text : '';
    const landing = yield* withoutAddedProse(resolved, filePath, source, params.newString);
    yield* fs.makeDirectory(dirname(filePath), { recursive: true });
    const kept = yield* recording(resolved, 'edit', filePath, {
      standing: existed ? { bytes: before.value.bytes } : { absent: true },
      before: source,
      after: landing.text,
      resource: prepared?.resource?.path,
    });
    const applied = existed ? 'Edit applied successfully.' : 'Edit applied successfully. (file created)';
    return new Tool.ToolAnswer(
      `${applied}${landing.sentence}${recordedSentence(kept)}`,
      existed
        ? filePatch(prepared?.resource?.root ?? resolved.cwd, filePath, source, landing.text)
        : fileCode(prepared?.resource?.root ?? resolved.cwd, filePath, landing.text, 'created'),
      { shown: [{ path: filePath, as: 'wrote' }] },
    );
  }

  const info = yield* orAbsent(fs.stat(filePath));
  if (!info) return yield* refused('not-found', `File ${filePath} not found`);
  if (info.type === 'Directory') {
    return yield* refused('wrong-kind', `Path is a directory, not a file: ${filePath}`);
  }

  const read = yield* fileContent(fs, filePath);
  const source = read.text;
  const ending = detectLineEnding(source);
  const oldString = convertToLineEnding(normalizeLineEndings(params.oldString), ending);
  const replacement = convertToLineEnding(normalizeLineEndings(params.newString), ending);
  const replaced = yield* Effect.result(
    Effect.try({
      try: () => replace(source, oldString, replacement, params.replaceAll ?? false),
      catch: (error) => (error instanceof ToolFailed ? error : foreignCause(error)),
    }),
  );
  if (replaced._tag === 'Failure') return yield* rewrittenNote(resolved, filePath, source, replaced.failure);
  const next = replaced.success;

  const landing = yield* withoutAddedProse(resolved, filePath, source, next);
  const kept = yield* recording(resolved, 'edit', filePath, {
    standing: { bytes: read.bytes },
    before: source,
    after: landing.text,
    resource: prepared?.resource?.path,
  });
  return new Tool.ToolAnswer(
    `Edit applied successfully.${landing.sentence}${recordedSentence(kept)}`,
    filePatch(prepared?.resource?.root ?? resolved.cwd, filePath, source, landing.text),
    { shown: [{ path: filePath, as: 'wrote' }] },
  );
});

export function createEditTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { cwd, world } = resolved;
  const editTool = Tool.make({
    approval: ASKS_IN_REVIEW,
    description: DESCRIPTION_EDIT,
    refusals: REFUSALS,
    parameters: editInputSchema,
    display: {
      streamFields: ['path'],
      project: (input) => ({ form: 'none', title: input.path === undefined ? undefined : displayPath(cwd, input.path) }),
    },
    prepare: (input) => Effect.flatMap(namedPath('path', input.path), (named) => pathPreparation(resolved, named, 'write')),
    claims: (input) => pathClaims(resolved, [input.path], 'write'),
    execute: (params, call) =>
      world.files === undefined
        ? unboundTool('edit', 'filesystem')
        : runToolEffect(
            'edit',
            world.files,
            inTurn(
              resolved.at(call.caller),
              call.prepared?.resource?.path ?? call.prepared?.target ?? params.path,
              withEntryWrite(
                cwd,
                call.prepared?.resource?.path ?? call.prepared?.target ?? params.path,
                run(resolved.at(call.caller), params, call.prepared),
              ),
            ),
            call,
          ),
    mutates: true,
    confirmation: {
      prompt: (input) => ({
        summary: `Edit ${input.path}?`,
        facts: [
          { label: 'Replace', value: input.oldString },
          { label: 'With', value: input.newString },
        ],
      }),
      confirmLabel: 'Edit',
    },
  });
  return editTool;
}
