import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {studios, hasDraft} from '../website/shared/studios.mjs';

const read = path => readFileSync(new URL('../website/' + path, import.meta.url), 'utf8');
const landing = read('index.html');
const icons = read('shared/icons.svg');

// One studio list drives the switcher; it must match the landing order and existing directories.
const cards = [...landing.matchAll(/data-draft-studio="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(cards, studios.map(studio => studio.id), 'Landing cards and switcher list differ');
for (const studio of studios) {
  assert.ok(existsSync(new URL(`../website/${studio.id}/index.html`, import.meta.url)), `${studio.id}: missing studio`);
  const html = read(`${studio.id}/index.html`);
  assert.ok(html.includes('href="../shared/werkstatt.css"'), `${studio.id}: shared stylesheet missing`);
  assert.ok(html.includes('src="../shared/werkstatt.mjs"'), `${studio.id}: shared module missing`);
  assert.ok(html.includes(`data-ws-switcher="${studio.id}"`), `${studio.id}: switcher missing`);
  assert.ok(html.includes(`data-app="${studio.id}"`), `${studio.id}: accent identity missing`);
  assert.ok(html.includes('id="werkbank"'), `${studio.id}: skip-link target missing`);
  assert.ok(html.indexOf('werkstatt.css') < html.search(/href="\.\/style\.css"|<style>/), `${studio.id}: shared stylesheet must load first`);
}
for (const id of [...landing.matchAll(/icons\.svg#(i-[a-z-]+)/g)].map(match => match[1])) assert.ok(icons.includes(`id="${id}"`), `Unknown icon ${id}`);

const storage = keys => ({getItem: key => keys.includes(key) ? '{}' : null});
const cards2 = studios.find(studio => studio.id === 'klappkarten-studio');
assert.equal(hasDraft(cards2, storage(['klappkarten-studio-project-v1'])), true, 'Legacy drafts count');
assert.equal(hasDraft(cards2, storage([])), false);
assert.equal(hasDraft(studios.find(studio => studio.id === 'zahnrad-studio'), storage(['x'])), false, 'Studios without storage never show drafts');
assert.equal(hasDraft(cards2, {getItem() { throw new Error('blocked'); }}), false, 'Blocked storage is ignored');
console.log(`Werkstatt shell passed: ${studios.length} studios share switcher, stylesheet, icons and draft hints.`);
