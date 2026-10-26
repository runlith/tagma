// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { doubleClick } from './doubleClick.js';

function setup(enabled = true) {
  const parent = document.createElement('div');
  const name = document.createElement('span');
  parent.append(name);
  let doubles = 0;
  let reachedParent = 0;
  parent.addEventListener('click', () => (reachedParent += 1));
  doubleClick(
    () => (doubles += 1),
    () => enabled,
  )(name);
  const click = (at: number, x = 10, detail = 1) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 10, detail });
    Object.defineProperty(event, 'timeStamp', { value: at });
    name.dispatchEvent(event);
  };
  return { click, doubles: () => doubles, reachedParent: () => reachedParent };
}

test('two pointer clicks within 250 ms and 4 px are one double click, and the second one goes no further', () => {
  const name = setup();
  name.click(1_000);
  name.click(1_200, 13);

  expect(name.doubles()).toBe(1);
  expect(name.reachedParent()).toBe(1);
});

test('a recognizer that is off lets both quick clicks through and fires nothing', () => {
  const name = setup(false);
  name.click(1_000);
  name.click(1_100);

  expect(name.doubles()).toBe(0);
  expect(name.reachedParent()).toBe(2);
});

test('a slower second click, a moved one or a keyboard click in between is no double click', () => {
  const name = setup();
  name.click(1_000);
  name.click(1_300);
  name.click(1_400, 20);
  name.click(1_500, 20, 0);
  name.click(1_550, 20);

  expect(name.doubles()).toBe(0);
  expect(name.reachedParent()).toBe(5);
});
