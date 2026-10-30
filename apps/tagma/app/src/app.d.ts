declare module '@runlith/layer/key' {
  interface Ladder {
    tile: object;
    project: { under: 'tile' };
    graph: { under: 'project' };
    thread: { under: 'project' };
  }
}

export {};
