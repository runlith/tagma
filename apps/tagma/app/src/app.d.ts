declare module '@runlith/layer/key' {
  interface Ladder {
    project: object;
    graph: { under: 'project' };
    thread: { under: 'project' };
  }
}

export {};
