import assert from 'node:assert/strict';
import { defaults, buildModel, placement, pairCollides, exportSVG, pathData, pointSegmentDistance } from '../website/zahnrad-studio/geometry.mjs';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
const settings = (a, b, extra = {}) => ({ ...defaults, ...extra, gears: [{ ...defaults.gears[0], teeth: a, style: 'solid' }, { ...defaults.gears[1], teeth: b, style: 'solid' }] });
const model = buildModel();
assert.equal(model.valid, true, model.errors.join('\n'));
assert.equal(model.meshValid, true);
assert.deepEqual(model.warnings, []);
const legacyOptions = { ...defaults, gears: defaults.gears.map(({ toothHeight, tipStyle, tipAmount, ...g }) => g) };
delete legacyOptions.pressureAngle;
delete legacyOptions.experimental;
assert.deepEqual(buildModel(legacyOptions).gears, model.gears, 'Existing designs keep the original default geometry');
close(model.gears[0].pitchRadius, 24);
close(model.gears[0].baseRadius, 24 * Math.cos(Math.PI / 9));
close(model.gears[0].rootRadius, 21.5);
close(model.gears[0].tipRadius, 26);
close(model.metrics.centerDistance, 60);
close(model.metrics.ratio, 1.5);
assert.ok(model.metrics.contactRatio > 1.6 && model.metrics.contactRatio < 1.7);
for (const g of model.gears) {
  assert.ok(g.minimumSpokeWeb >= defaults.minWeb);
  assert.ok(g.minimumHubWeb >= defaults.minWeb);
  for (const points of [g.outline, ...g.windows]) {
    assert.ok(points.length > 3);
    assert.ok(points.every(p => p.length === 2 && p.every(Number.isFinite)));
    assert.match(pathData(points), / Z$/);
    assert.notDeepEqual(points.at(-1), points[0], 'Contours close with Z without a zero-length final edge');
  }
}

const mounted = placement(model);
close(mounted.entries[1].angle, Math.PI - Math.PI / 36);
const angle = .27, turned = placement(model, 'pair', angle);
close(turned.entries[0].angle, angle);
close(turned.entries[1].angle - mounted.entries[1].angle, -angle * 24 / 36);
const cut = placement(model, 'cut');
close(cut.entries[1].x - model.gears[1].tipRadius - model.gears[0].tipRadius, 5);
close(cut.bounds.width, 2 * 26 + 2 * 38 + 5);

// Independent strict polygon segment intersection check across a full tooth cycle.
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const intersect = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -1e-16 && cross(c, d, a) * cross(c, d, b) < -1e-16;
function assertSimple(points) {
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const [p, q, r, s] = [points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length]];
    if (Math.max(p[0], q[0]) < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) < Math.min(p[0], q[0]) || Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) < Math.min(p[1], q[1])) continue;
    assert.equal(intersect(p, q, r, s), false, 'A cut contour cannot intersect itself');
  }
}
for (const g of model.gears) for (const contour of [g.outline, g.windows[0]]) assertSimple(contour);
function independentPairCheck(m) {
  for (let step = 0; step < 60; step++) {
    const polygons = placement(m, 'pair', 2 * Math.PI / m.gears[0].teeth * step / 60).entries.map(e => e.gear.outline.map(([x, y]) => [e.x + x * Math.cos(e.angle) - y * Math.sin(e.angle), x * Math.sin(e.angle) + y * Math.cos(e.angle)]));
    const center = m.metrics.centerDistance, [a, b] = m.gears;
    const local = polygons.map(points => points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length];
      return Math.max(p[0], q[0]) >= center - b.tipRadius && Math.min(p[0], q[0]) <= a.tipRadius ? [[p, q]] : [];
    }));
    for (const [p, q] of local[0]) for (const [r, s] of local[1]) assert.equal(intersect(p, q, r, s), false, 'Meshed teeth cannot cross');
  }
}
for (const [a, b] of [[18, 18], [24, 36], [19, 31], [18, 120], [120, 120]]) {
  const m = buildModel(settings(a, b));
  assert.equal(m.valid, true, `${a}:${b}: ${m.errors.join(', ')}`);
  assert.equal(pairCollides(m, 96), false);
  independentPairCheck(m);
}
for (const module of [.5, 5]) {
  const m = buildModel(settings(18, 120, { module, backlash: 0 }));
  assert.equal(m.valid, true, m.errors.join(', '));
  independentPairCheck(m);
}
const collided = structuredClone(model);
collided.metrics.centerDistance -= .5;
assert.equal(pairCollides(collided), true, 'Collision detection must detect an incorrect center distance');

// Check approximation against analytic involute flanks between polygon vertices.
for (const g of model.gears) {
  const inv = r => { const t = Math.sqrt(Math.max(0, (r / g.baseRadius) ** 2 - 1)); return t - Math.atan(t); };
  const baseHalf = Math.PI / (2 * g.teeth) - model.options.backlash / (4 * g.pitchRadius) + inv(g.pitchRadius);
  const firstTooth = g.outline.filter(([x, y]) => Math.abs(Math.atan2(y, x)) < Math.PI / g.teeth);
  for (const sign of [-1, 1]) for (let n = 0; n <= 100; n++) {
    const r = Math.max(g.baseRadius, g.rootRadius) + (g.tipRadius - Math.max(g.baseRadius, g.rootRadius)) * n / 100;
    const a = sign * (baseHalf - inv(r)), p = [r * Math.cos(a), r * Math.sin(a)];
    const error = Math.min(...firstTooth.slice(0, -1).map((q, i) => pointSegmentDistance(p, q, firstTooth[i + 1])));
    assert.ok(error <= model.tolerance, `Involute approximation error ${error} exceeds ${model.tolerance}`);
  }
}

for (const style of ['straight', 'curved', 'solid']) {
  const m = buildModel({ ...defaults, gears: defaults.gears.map(g => ({ ...g, style, bend: 40 })) });
  assert.equal(m.valid, true, `${style}: ${m.errors.join(', ')}`);
  assert.equal(m.gears[0].windows.length, style === 'solid' ? 0 : 6);
  if (style !== 'solid') {
    assert.ok(m.gears.every(g => g.minimumSpokeWeb >= defaults.minWeb));
    m.gears.forEach(g => assertSimple(g.windows[0]));
  }
}
const invalid = [
  { module: NaN }, { module: .049 }, { backlash: -1 }, { backlash: 3.5 }, { minWeb: Infinity }, { cutColor: 'red" onload="alert(1)' },
  { gears: [{ teeth: 17 }] }, { gears: [{ teeth: 24.5 }] }, { gears: [{ bore: 45 }] },
  { gears: [{ hub: 4 }] }, { gears: [{ rim: 1 }] }, { gears: [{ spokeWidth: 1 }] },
  { gears: [{ spokes: 2 }] }, { gears: [{ spokes: 25 }] }, { gears: [{ bend: 41, style: 'curved' }] }, { gears: [{ hub: 40, rim: 10 }] },
  { gears: [{ hub: 6, bore: 3 }] }, { gears: [{ style: 'unknown' }] }
];
for (const input of invalid) {
  const m = buildModel(input);
  assert.equal(m.valid, false, `Should reject ${JSON.stringify(input)}`);
  assert.ok(m.errors.length);
  assert.throws(() => exportSVG(m));
}
assert.equal(buildModel({ gears: [{ style: 'solid', hub: NaN, spokes: 0, rim: 0, spokeWidth: 0 }] }).valid, true, 'Irrelevant solid-disc controls are ignored');
const borderlineBore = buildModel({ gears: [{ style: 'solid', bore: 40 }, { style: 'solid' }] });
assert.equal(borderlineBore.valid, false, 'Root arc chords reduce clearance below the analytic root radius');
assert.ok(borderlineBore.gears[0].minimumRootRadius - 20 < defaults.minWeb);
assert.ok(borderlineBore.errors.some(error => error.includes('Achsenloch verkleinern')));
assert.equal(buildModel({ gears: [{ style: 'solid', bore: 39.99 }, { style: 'solid' }] }).valid, true);
assert.equal(buildModel({ gears: [{ rim: defaults.minWeb }] }).valid, false, 'Rim clearance also uses the actual outline chords');

function assertPolarMonotone(points) {
  let previous = Math.atan2(points[0][1], points[0][0]);
  const start = previous;
  for (const p of points.slice(1)) {
    let a = Math.atan2(p[1], p[0]);
    if (a < start - 1e-12) a += 2 * Math.PI;
    assert.ok(a >= previous - 1e-12, 'The outline stays angularly ordered and cannot cross itself');
    previous = a;
  }
}
for (const [a, b] of [[18, 18], [18, 720], [720, 720]]) {
  const m = buildModel({ ...settings(a, b, { module: .05, backlash: 0, minWeb: .1 }), gears: settings(a, b).gears.map(g => ({ ...g, bore: 0 })) });
  assert.equal(m.valid, true, m.errors.join(', '));
  assert.equal(m.meshValid, true);
  m.gears.forEach(g => assertPolarMonotone(g.outline));
  assert.equal(pairCollides(m, 96), false);
}
const heights = [.7, 1.15];
const asymmetric = buildModel({ gears: defaults.gears.map((g, i) => ({ ...g, toothHeight: heights[i] })) });
assert.equal(asymmetric.valid, true, asymmetric.errors.join(', '));
asymmetric.gears.forEach((g, i) => {
  close(g.tipRadius, g.pitchRadius + defaults.module * heights[i]);
  close(g.rootRadius, g.pitchRadius - defaults.module * (heights[1 - i] + .25));
});
independentPairCheck(asymmetric);
const mixedEnds = buildModel({ gears: defaults.gears.map((g, i) => ({ ...g, toothHeight: heights[i], tipStyle: i ? 'chamfered' : 'rounded', tipAmount: .2 })) });
assert.equal(mixedEnds.valid, true, mixedEnds.errors.join(', '));
assert.equal(mixedEnds.gears[0].tipStyle, 'rounded');
assert.equal(mixedEnds.gears[1].tipStyle, 'chamfered');
independentPairCheck(mixedEnds);

for (const tipStyle of ['standard', 'flat', 'pointed', 'rounded', 'chamfered']) for (const tipAmount of [0, .35, 1]) {
  const m = buildModel({ experimental: true, gears: defaults.gears.map(g => ({ ...g, tipStyle, tipAmount })) });
  assert.equal(m.valid, true, `${tipStyle}/${tipAmount}: ${m.errors.join(', ')}`);
  m.gears.forEach(g => {
    assertPolarMonotone(g.outline);
    assert.ok(g.outline.every((p, i) => Math.hypot(p[0] - g.outline[(i + 1) % g.outline.length][0], p[1] - g.outline[(i + 1) % g.outline.length][1]) > 1e-8), 'Cap contours have no duplicate vertices or zero-length edges');
    assert.ok(g.outline.every(p => Math.hypot(...p) <= g.tipRadius + 1e-10));
    assert.match(pathData(g.outline), / Z$/);
    const inv = r => { const t = Math.sqrt(Math.max(0, (r / g.baseRadius) ** 2 - 1)); return t - Math.atan(t); };
    const baseHalf = Math.PI / (2 * g.teeth) - m.options.backlash / (4 * g.pitchRadius) + inv(g.pitchRadius);
    const capHalf = baseHalf - inv(g.activeRadius);
    const tooth = g.outline.filter(p => Math.abs(Math.atan2(p[1], p[0])) <= capHalf + 1e-10);
    // Test edge interiors too: cap chords must stay inside the original involute envelope.
    for (let i = 0; i < tooth.length - 1; i++) for (let step = 0; step <= 10; step++) {
      const p = tooth[i], q = tooth[i + 1], t = step / 10;
      const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, r = Math.hypot(x, y);
      if (r >= g.activeRadius - 1e-10) assert.ok(inv(r) + Math.abs(Math.atan2(y, x)) <= baseHalf + 1e-9, `${tipStyle} remains inside its original flank envelope`);
    }
    if (['pointed', 'rounded', 'chamfered'].includes(tipStyle)) close(g.activeRadius, g.pitchRadius + m.options.module * g.toothHeight * (1 - tipAmount));
    else close(g.activeRadius, g.tipRadius);
  });
  if (tipAmount === .35) {
    assert.equal(m.meshValid, true);
    independentPairCheck(m);
  }
}
const shallow = { gears: defaults.gears.map(g => ({ ...g, toothHeight: .05 })) };
assert.equal(buildModel(shallow).valid, false, 'Shallow teeth cannot silently bypass continuous-contact checks');
const experimentalShallow = buildModel({ ...shallow, experimental: true });
assert.equal(experimentalShallow.valid, true);
assert.equal(experimentalShallow.meshValid, false);
assert.ok(experimentalShallow.warnings.some(w => w.includes('Überdeckung')));
assert.match(exportSVG(experimentalShallow), /<desc>Experimentelles freies Profil:.*zu wenig Überdeckung/);
for (const pressureAngle of [5, 45]) {
  const m = buildModel({ ...shallow, pressureAngle, experimental: true });
  assert.equal(m.valid, true, `${pressureAngle}° shallow tooth profiles remain structurally possible`);
  close(m.gears[0].baseRadius, m.gears[0].pitchRadius * Math.cos(pressureAngle * Math.PI / 180));
  m.gears.forEach(g => assertPolarMonotone(g.outline));
}
const interfering = { ...settings(19, 31), pressureAngle: 5 };
assert.equal(buildModel(interfering).valid, false);
const freeInterfering = buildModel({ ...interfering, experimental: true });
assert.equal(freeInterfering.valid, true);
assert.equal(freeInterfering.meshValid, false);
assert.equal(pairCollides(freeInterfering, 96), true, 'Unequal pairs with true interference are detected');
assert.ok(freeInterfering.warnings.some(w => w.includes('überschneiden')));
assert.match(exportSVG(freeInterfering), /<desc>Experimentelles freies Profil:.*überschneiden/);
for (const options of [{ pressureAngle: 4.9 }, { pressureAngle: 45.1 }, { pressureAngle: NaN }, { gears: [{ teeth: 721 }] }, { gears: [{ toothHeight: .049 }] }, { gears: [{ toothHeight: 1.51 }] }, { gears: [{ tipStyle: 'hacked' }] }, { gears: [{ tipAmount: -.01 }] }, { gears: [{ tipAmount: 1.01 }] }, { pressureAngle: 45 }, { backlash: 3.5 }]) {
  const m = buildModel({ ...options, experimental: true });
  assert.equal(m.valid, false, `Experimental mode cannot bypass structural constraints: ${JSON.stringify(options)}`);
  assert.throws(() => exportSVG(m));
}
assert.equal(buildModel({ experimental: 'yes' }).valid, false);

const svg = exportSVG(model);
assert.match(svg, /width="133\.2mm" height="76\.2mm"/);
assert.match(svg, /stroke="#ff0000" stroke-width="0\.1"/);
assert.equal((svg.match(/id="zahnrad-/g) || []).length, 2);
assert.ok(!/animation|teilkreis|achse|text|script|foreignObject/i.test(svg));
for (const g of model.gears) assert.ok(svg.indexOf(`<circle cx="0" cy="0" r="${g.bore / 2}"`) < svg.indexOf(`<path d="${pathData(g.outline)}"`), 'Interior cuts precede the outline');
const firstOuter = Math.min(...model.gears.map(g => svg.indexOf(`<path d="${pathData(g.outline)}"`)));
const lastInner = Math.max(svg.lastIndexOf('<circle'), ...model.gears.flatMap(g => g.windows.map(p => svg.lastIndexOf(`<path d="${pathData(p)}"`))));
assert.ok(lastInner < firstOuter, 'Every interior cut of both gears precedes every outer contour');
assert.equal((exportSVG(model, 'gear1').match(/id="zahnrad-/g) || []).length, 1);
assert.ok(exportSVG(model, 'gear2').includes('id="zahnrad-2"'));
const tampered = structuredClone(model);
tampered.gears[0].outline[0][0] = NaN;
assert.throws(() => exportSVG(tampered), /verändert/);
const alteredProfile = structuredClone(model);
alteredProfile.options.gears[0].tipStyle = 'pointed';
assert.throws(() => exportSVG(alteredProfile), /verändert/, 'New profile controls are revalidated at the export boundary');
assert.throws(() => exportSVG(model, 'unknown'));

console.log('OK: involute accuracy, fine teeth, safe endforms, asymmetric meshing, experimental warnings, material webs and SVG exports');
