import { jsonCodec } from '@runlith/utils/codec';
import { Result, Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

type PluginFaces = ReadonlyMap<string, PluginFace<any>>;

export type PluginChecked = Readonly<Record<string, unknown>>;

const codecs = new WeakMap<PluginFace<any>, Schema.Codec<unknown, unknown>>();

const codecOf = (face: PluginFace<any>): Schema.Codec<unknown, unknown> => {
  const standing = codecs.get(face);
  if (standing !== undefined) return standing;
  const codec: Schema.Codec<unknown, unknown> = jsonCodec(Schema.optional(face.schema));
  codecs.set(face, codec);
  return codec;
};

export const contributionsRefusal = (
  plugin: string,
  faces: PluginFaces,
  contributes: Readonly<Record<string, unknown>>,
): Result.Result<PluginChecked, string> => {
  const named = Object.entries(contributes);
  const unknown = named.filter(([name]) => !faces.has(name)).map(([name]) => name);
  if (unknown.length > 0)
    return Result.fail(
      `${unknown.join(', ')} ${unknown.length === 1 ? 'is a point' : 'are points'} no owner of this server declares; the points are ${[...faces.keys()].join(', ')}`,
    );
  const checked: Record<string, unknown> = {};
  for (const [name, raw] of named) {
    const decoded = Schema.decodeUnknownResult(codecOf(faces.get(name)!))(raw, { onExcessProperty: 'error' });
    if (Result.isFailure(decoded)) return Result.fail(`contributes.${name}: ${decoded.failure.message}`);
    if (decoded.success !== undefined) checked[name] = decoded.success;
  }
  const sibling = <B>(face: PluginFace<B>): B | undefined =>
    faces.get(face.name) === face ? (checked[face.name] as B | undefined) : undefined;
  const server = [...faces.values()].find((face) => face.serves !== undefined);
  for (const [name, value] of Object.entries(checked)) {
    const face = faces.get(name)!;
    const refused = face.refuses?.(value, { plugin, sibling });
    if (refused !== undefined && refused !== null) return Result.fail(`contributes.${name}: ${refused}`);
    for (const tool of face.calls?.(value) ?? []) {
      const unserved = server?.serves?.(checked[server.name], tool) ?? null;
      if (unserved !== null) return Result.fail(`contributes.${name}: ${unserved}`);
    }
  }
  return Result.succeed(checked);
};
