declare module './key.js' {
  interface Ladder {
    visitor: { kinds: 'user' | 'guest' };
    room: { under: 'visitor' };
    desk: { under: 'visitor' };
    hall: { always: true };
    seat: { under: 'room'; always: true };
  }
}

export {};
