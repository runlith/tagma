import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';

export const pageRender = manifest({
  id: 'page-render',
  title: 'Pages drawn by their timeline in a browser host',
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ renderLayer }) => renderLayer,
    ),
  },
});
