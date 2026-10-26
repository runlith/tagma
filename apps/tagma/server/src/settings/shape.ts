import { schemaShape } from '../platform/contract/wire/shape.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';

const shapes = new WeakMap<SettingKey<unknown>, string>();

export const shapeOf = (key: SettingKey<unknown>): string => {
  const held = shapes.get(key);
  if (held !== undefined) return held;
  const shape = schemaShape(key.schema);
  shapes.set(key, shape);
  return shape;
};
