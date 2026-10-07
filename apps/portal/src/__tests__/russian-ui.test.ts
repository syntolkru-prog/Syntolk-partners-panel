// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { installRussianUi } from '../i18n.js';

it('translates newly inserted text nodes without treating them as queryable elements', async () => {
  document.body.innerHTML = '<div id="label">Partner</div>';
  installRussianUi();
  expect(document.querySelector('#label')!.textContent).toBe('Партнёр');
  const holder = document.createElement('span');
  document.body.append(holder);
  holder.append(document.createTextNode('Partner'));
  await Promise.resolve();
  expect(holder.textContent).toBe('Партнёр');
});
