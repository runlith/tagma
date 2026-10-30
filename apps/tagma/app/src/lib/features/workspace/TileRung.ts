import { Rung } from '@runlith/layer/Rung';
import { Workspace } from './Selection.svelte.js';

export type TileAim = { readonly tileId: number };

export const TileRung = Rung.define<TileAim>()('tile', { keyOf: ({ tileId }) => String(tileId) });

export const TileRungSource = TileRung.from(Workspace, (workspace) => {
  const tile = workspace.contextTile;
  return tile === null ? undefined : { tileId: tile.id };
});
