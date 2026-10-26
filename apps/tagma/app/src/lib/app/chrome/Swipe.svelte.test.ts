import { expect, test } from 'vitest';
import { REACH, Swipe } from './Swipe.svelte.js';

const open = () => true;
const untaken = () => false;

const swiped = (swipe: Swipe, pulls: readonly number[]) => {
  swipe.began();
  for (const dx of pulls) swipe.moved(dx, 0, untaken);
  return swipe.ended();
};

test('a sideways pull past its reach steps that way on release, and easing back before release cancels it', () => {
  const swipe = new Swipe(open);
  expect(swiped(swipe, [-REACH / 2, -REACH / 2 - 1])).toBe('back');
  expect(swiped(swipe, [REACH + 1])).toBe('forward');
  expect(swiped(swipe, [-REACH - 20, REACH / 2])).toBeNull();
});

test('a vertical scroll, a pull with no history that way, or a gesture whose early wheel the content took never arms', () => {
  const swipe = new Swipe(open);
  swipe.began();
  swipe.moved(-4, 10, untaken);
  swipe.moved(-REACH * 2, 0, untaken);
  expect(swipe.pull).toBeNull();
  expect(swipe.ended()).toBeNull();

  expect(swiped(new Swipe(() => false), [-REACH * 2])).toBeNull();

  swipe.began();
  swipe.moved(-6, 0, () => true);
  swipe.moved(-6, 0, untaken);
  swipe.moved(-REACH * 2, 0, untaken);
  expect(swipe.pull).toBeNull();
  expect(swipe.ended()).toBeNull();
});

test('wheel outside a finger phase, as momentum after release, moves nothing', () => {
  const swipe = new Swipe(open);
  expect(swiped(swipe, [-REACH / 2])).toBeNull();
  swipe.moved(-REACH * 2, 0, untaken);
  expect(swipe.pull).toBeNull();
  expect(swipe.ended()).toBeNull();
});
