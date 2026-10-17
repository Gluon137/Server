import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaults, clone, validateProject, boundaries, outsideFaces, panelFacets, addCell, removeCell, togglePanel, openedFacets} from '../website/baustein-studio/project.mjs';

// Every prepend shifts all existing identities, including saved open facets.
for (const [index, axis] of ['x', 'y', 'z'].entries()) {
  const p = clone(defaults), faceAxis = axis === 'z' ? 'x' : 'z';
  p.openFaces = [`0,0,0:${faceAxis}:1`];
  p.axes[axis][0] = 83;
  const added = addCell(p, [0, 0, 0], axis, -1), old = [0, 0, 0];
  old[index] = 1;
  assert.deepEqual(added, [0, 0, 0]);
  assert.ok(p.cells.some(cell => cell.join(',') === old.join(',')));
  assert.deepEqual(p.axes[axis], [83, 83]);
  assert.deepEqual(p.openFaces, [`${old.join(',')}:${faceAxis}:1`]);
  assert.deepEqual(boundaries(p)[axis], [0, 83, 166]);
  validateProject(p);
}

const merged = clone(defaults);
merged.openFaces = ['0,0,0:z:1', '0,0,0:x:1'];
addCell(merged, [0, 0, 0], 'x', 1);
assert.deepEqual(merged.openFaces, ['0,0,0:z:1'], 'An internalized face loses its open marker');
assert.equal(outsideFaces(merged).length, 10, 'Neighboring blocks expose no internal facets');
assert.deepEqual(new Set(panelFacets(merged, '1,0,0:z:1')), new Set(['0,0,0:z:1', '1,0,0:z:1']));
assert.ok(openedFacets(merged).has('1,0,0:z:1'), 'One persisted open facet opens its entire merged panel');
togglePanel(merged, '1,0,0:z:1');
assert.deepEqual(merged.openFaces, [], 'First toggle closes a partially marked merged panel');
togglePanel(merged, '0,0,0:z:1');
assert.deepEqual(new Set(merged.openFaces), new Set(['0,0,0:z:1', '1,0,0:z:1']));
merged.axes.x[0] = 120;
assert.ok(openedFacets(merged).has('1,0,0:z:1'), 'Dimension edits retain facet identity');
removeCell(merged, [1, 0, 0]);
assert.deepEqual(merged.openFaces, ['0,0,0:z:1'], 'Removing a block removes only its persisted facet markers');
removeCell(merged, [0, 0, 0]);
assert.deepEqual(merged.openFaces, []);
assert.deepEqual(addCell(merged, null), [0, 0, 0], 'An empty project can be built again');

const original = clone(defaults), imported = validateProject(JSON.parse(JSON.stringify(original)));
imported.axes.x[0] = 125;
imported.cells[0][0] = 3;
assert.deepEqual(original, defaults, 'Imported values are copied independently of the source');
const decorated = {...clone(defaults), html: '<script>alert(1)</script>'};
assert.equal('html' in validateProject(decorated), false, 'Unknown file content never becomes app state');

const malformed = [null, [], {}, {...clone(defaults), version: true}];
for (const [group, key, value] of [['joint', 'thickness', NaN], ['joint', 'thickness', true], ['joint', 'relative', 1],
  ['layout', 'width', Infinity], ['layout', 'rotate', 'yes'], ['axes', 'x', [null]], ['axes', 'x', [false]],
  ['axes', 'x', []], ['axes', 'x', [3001]], ['axes', 'x', Array(33).fill(1)]]) {
  const p = clone(defaults); p[group][key] = value; malformed.push(p);
}
for (const [group, key, value] of [['joint', 'thickness', -1], ['joint', 'thickness', .49], ['joint', 'thickness', 101],
  ['joint', 'finger', 0], ['joint', 'space', 1001], ['joint', 'surroundingspaces', 101], ['joint', 'play', -1],
  ['joint', 'burn', 101], ['layout', 'width', 0], ['layout', 'height', 10001], ['layout', 'margin', -1],
  ['layout', 'spacing', 1001]]) {
  const p = clone(defaults); p[group][key] = value; malformed.push(p);
}
for (const cells of [[[true, 0, 0]], [[.5, 0, 0]], [[0, 0]], [[2, 0, 0]], [[0, 0, 0], [0, 0, 0]]]) {
  const p = clone(defaults); p.cells = cells; malformed.push(p);
}
for (const p of malformed) assert.throws(() => validateProject(p), 'Malformed import must preserve the existing project');
const needsCorrection = clone(defaults); needsCorrection.axes.x = [100, 100, 100]; needsCorrection.cells = [[0, 0, 0], [2, 0, 0]];
assert.deepEqual(validateProject(needsCorrection).cells, needsCorrection.cells, 'Unsupported geometry remains editable for backend diagnostics');

const html = readFileSync(new URL('../website/baustein-studio/index.html', import.meta.url), 'utf8');
const staticIds = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
const generatedIds = ['dim-x', 'dim-y', 'dim-z', ...Object.keys(defaults.joint).filter(key => key !== 'relative'),
  ...Object.keys(defaults.layout).filter(key => key !== 'rotate')];
const allIds = [...staticIds, ...generatedIds];
assert.equal(new Set(allIds).size, allIds.length, 'Static controls and generated material/layout controls must have unique IDs');
console.log('OK: prepend dimensions, open merged facets, removal, import integrity and unique control IDs');
