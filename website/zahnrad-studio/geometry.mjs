const TAU = Math.PI * 2;
const EPS = 1e-8;

export const defaults = {
  module: 2, backlash: 0.1, minWeb: 1.5, cutColor: '#ff0000', pressureAngle: 20, experimental: false,
  gears: [
    { teeth: 24, bore: 3, hub: 14, rim: 4, style: 'straight', spokes: 6, spokeWidth: 4, bend: 20, toothHeight: 1, tipStyle: 'standard', tipAmount: .35 },
    { teeth: 36, bore: 3, hub: 18, rim: 4, style: 'straight', spokes: 6, spokeWidth: 4, bend: 20, toothHeight: 1, tipStyle: 'standard', tipAmount: .35 }
  ]
};

const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const rotate = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const involute = (r, base) => {
  const t = Math.sqrt(Math.max(0, (r / base) ** 2 - 1));
  return t - Math.atan(t);
};

export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

function crossing(a, b, c, d) {
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d);
  const cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  return ab1 * ab2 < -EPS * EPS && cd1 * cd2 < -EPS * EPS;
}

function segmentDistance(a, b, c, d) {
  if (crossing(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

// Quarter checks also catch the inflection in a curved spoke boundary.
function curve(fn, start, end, tolerance) {
  const result = [fn(start)];
  function subdivide(t0, a, t1, b, depth) {
    const ts = [.25, .5, .75].map(f => t0 + (t1 - t0) * f);
    if (depth < 20 && ts.some(t => pointSegmentDistance(fn(t), a, b) > tolerance * .8)) {
      const middle = ts[1], p = fn(middle);
      subdivide(t0, a, middle, p, depth + 1);
      subdivide(middle, p, t1, b, depth + 1);
    } else result.push(b);
  }
  subdivide(start, result[0], end, fn(end), 0);
  return result;
}

function append(points, next) {
  for (const p of next) if (!points.length || distance(points.at(-1), p) > EPS) points.push(p);
}

function prepareProfile(g, options, errors, prefix) {
  const pitch = TAU / g.teeth;
  const half = Math.PI / (2 * g.teeth) - options.backlash / (4 * g.pitchRadius);
  const baseHalf = half + involute(g.pitchRadius, g.baseRadius);
  const startRadius = Math.max(g.rootRadius, g.baseRadius);
  const rootHalf = baseHalf - involute(startRadius, g.baseRadius);
  const tipHalf = baseHalf - involute(g.tipRadius, g.baseRadius);
  if (g.rootRadius <= 0 || startRadius >= g.tipRadius || rootHalf >= pitch / 2 || rootHalf <= 0) errors.push(`${prefix}: Zahnfuß und Flanken überlappen sich. Eingriffswinkel oder Zahnhöhen verkleinern, alternativ die Zähnezahl erhöhen.`);
  if (tipHalf <= 0) errors.push(`${prefix}: Die Flanken treffen sich vor der Zahnspitze. Zahnhöhe, Eingriffswinkel oder Zahnspiel verkleinern.`);
  g.tipWidth = 2 * g.tipRadius * Math.sin(tipHalf);
  if (g.tipWidth < .1 * options.module) errors.push(`${prefix}: Die Zahnspitzen sind zu schmal. Zahnspiel oder Zahnhöhe verkleinern.`);
  g.activeRadius = ['pointed', 'rounded', 'chamfered'].includes(g.tipStyle) ? g.pitchRadius + options.module * g.toothHeight * (1 - g.tipAmount) : g.tipRadius;
  return { pitch, baseHalf, startRadius, rootHalf, tipHalf };
}

function outlineFor(g, profile, tolerance) {
  const { pitch, baseHalf, startRadius, rootHalf, tipHalf } = profile;
  const cutHalf = baseHalf - involute(g.activeRadius, g.baseRadius);
  const local = [];
  append(local, [polar(g.rootRadius, -rootHalf)]);
  append(local, curve(r => polar(r, -baseHalf + involute(r, g.baseRadius)), startRadius, g.activeRadius, tolerance));
  if (g.tipStyle === 'standard') append(local, curve(a => polar(g.tipRadius, a), -tipHalf, tipHalf, tolerance));
  else if (g.tipStyle === 'flat') append(local, [polar(g.tipRadius, -tipHalf), polar(g.tipRadius, tipHalf)]);
  else {
    // Polar caps only remove material: clipping to the analytic flank envelope
    // keeps every contour simple and angularly ordered, even for a pointed cap.
    const cap = a => {
      const t = Math.abs(a) / cutHalf;
      const shape = g.tipStyle === 'pointed' ? 1 - t : g.tipStyle === 'rounded' ? Math.cos(t * Math.PI / 2) : Math.min(1, 2 * (1 - t));
      const proposed = g.activeRadius + (g.tipRadius - g.activeRadius) * Math.max(0, shape);
      if (Math.abs(a) <= tipHalf) return polar(proposed, a);
      let lo = g.activeRadius, hi = g.tipRadius;
      for (let n = 0; n < 40; n++) {
        const middle = (lo + hi) / 2;
        if (involute(middle, g.baseRadius) < baseHalf - Math.abs(a)) lo = middle; else hi = middle;
      }
      return polar(Math.min(proposed, lo), a);
    };
    // Split at the apex and chamfer corners so coarse sampling cannot erase them.
    const breaks = g.tipStyle === 'chamfered' ? [-cutHalf, -cutHalf / 2, 0, cutHalf / 2, cutHalf] : [-cutHalf, 0, cutHalf];
    for (let i = 1; i < breaks.length; i++) append(local, curve(cap, breaks[i - 1], breaks[i], tolerance));
  }
  append(local, curve(r => polar(r, baseHalf - involute(r, g.baseRadius)), g.activeRadius, startRadius, tolerance));
  append(local, [polar(g.rootRadius, rootHalf)]);
  append(local, curve(a => polar(g.rootRadius, a), rootHalf, pitch - rootHalf, tolerance));
  const points = [];
  for (let tooth = 0; tooth < g.teeth; tooth++) {
    append(points, local.map(p => rotate(p, tooth * pitch)));
  }
  if (distance(points[0], points.at(-1)) < EPS) points.pop();
  return points;
}

function windowFor(g, tolerance) {
  const inner = g.hub / 2, outer = g.rootRadius - g.rim;
  const sector = TAU / g.spokes;
  const twist = r => g.style === 'curved' ? (g.bend * Math.PI / 180) * ((r - inner) / (outer - inner)) : 0;
  const halfSpoke = r => Math.asin(g.spokeWidth / (2 * r));
  const points = [];
  append(points, curve(r => polar(r, halfSpoke(r) + twist(r)), inner, outer, tolerance));
  append(points, curve(a => polar(outer, a), halfSpoke(outer) + twist(outer), sector - halfSpoke(outer) + twist(outer), tolerance));
  append(points, curve(r => polar(r, sector - halfSpoke(r) + twist(r)), outer, inner, tolerance));
  append(points, curve(a => polar(inner, a), sector - halfSpoke(inner), halfSpoke(inner), tolerance));
  if (distance(points[0], points.at(-1)) < EPS) points.pop();
  return points;
}

function polygonSeparation(a, b) {
  let minimum = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    minimum = Math.min(minimum, segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
  }
  return minimum;
}

function numberError(errors, value, minimum, maximum, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    errors.push(`${label}: Bitte ${integer ? 'eine ganze Zahl' : 'einen Wert'} zwischen ${minimum} und ${maximum} eingeben.`);
  }
}

export function buildModel(input = defaults) {
  const options = { ...defaults, ...input, gears: [0, 1].map(i => ({ ...defaults.gears[i], ...input?.gears?.[i] })) };
  const errors = [];
  numberError(errors, options.module, .05, 5, 'Modul');
  numberError(errors, options.backlash, 0, options.module * 2, 'Zahnspiel');
  numberError(errors, options.minWeb, .1, 20, 'Minimaler Materialsteg');
  numberError(errors, options.pressureAngle, 5, 45, 'Eingriffswinkel');
  if (typeof options.experimental !== 'boolean') errors.push('Experimenteller Modus: Bitte ein- oder ausschalten.');
  if (typeof options.cutColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(options.cutColor)) errors.push('Schnittfarbe: Bitte eine gültige Farbe auswählen.');
  options.gears.forEach((g, i) => {
    const prefix = `Zahnrad ${i + 1}`;
    numberError(errors, g.teeth, 18, 720, `${prefix} – Zähne`, true);
    numberError(errors, g.bore, 0, 600, `${prefix} – Achsenloch`);
    numberError(errors, g.toothHeight, .05, 1.5, `${prefix} – Zahnhöhe`);
    numberError(errors, g.tipAmount, 0, 1, `${prefix} – Endform-Anteil`);
    if (!['standard', 'flat', 'pointed', 'rounded', 'chamfered'].includes(g.tipStyle)) errors.push(`${prefix}: Bitte eine gültige Zahnendform auswählen.`);
    if (!['solid', 'straight', 'curved'].includes(g.style)) errors.push(`${prefix}: Bitte eine gültige Speichenform auswählen.`);
    if (g.style !== 'solid') {
      numberError(errors, g.hub, .1, 600, `${prefix} – Nabe`);
      numberError(errors, g.rim, .1, 300, `${prefix} – Rand`);
      numberError(errors, g.spokes, 3, 24, `${prefix} – Speichen`, true);
      numberError(errors, g.spokeWidth, .1, 300, `${prefix} – Speichenbreite`);
      if (g.style === 'curved') numberError(errors, g.bend, 0, 40, `${prefix} – Biegung`);
    }
  });
  const tolerance = Math.min(.005, .0025 * options.module);
  const warnings = [];
  const model = { options, gears: [], errors, warnings, valid: false, meshValid: false, tolerance, metrics: {} };
  if (errors.length) return model;
  const pressure = options.pressureAngle * Math.PI / 180;
  model.gears = options.gears.map((settings, index) => {
    const pitchRadius = options.module * settings.teeth / 2;
    const g = { ...settings, pitchRadius, baseRadius: pitchRadius * Math.cos(pressure), rootRadius: pitchRadius - (options.gears[1 - index].toothHeight + .25) * options.module, tipRadius: pitchRadius + settings.toothHeight * options.module, windows: [], outline: [] };
    const prefix = `Zahnrad ${index + 1}`;
    const count = errors.length;
    const profile = prepareProfile(g, options, errors, prefix);
    if (errors.length > count) return g;
    g.outline = outlineFor(g, profile, tolerance);
    g.minimumRootRadius = Math.min(...g.outline.map((p, i) => pointSegmentDistance([0, 0], p, g.outline[(i + 1) % g.outline.length])));
    if (g.minimumRootRadius - g.bore / 2 < options.minWeb) errors.push(`${prefix}: Achsenloch verkleinern; zum Zahnfuß muss der minimale Materialsteg bleiben.`);
    if (g.style !== 'solid') {
      const inner = g.hub / 2, outer = g.rootRadius - g.rim;
      if (inner - g.bore / 2 < options.minWeb) errors.push(`${prefix}: Nabe vergrößern oder Achsenloch verkleinern, damit der Materialsteg erhalten bleibt.`);
      if (g.minimumRootRadius - outer < options.minWeb) errors.push(`${prefix}: Randbreite auf mindestens ${(options.minWeb + g.rootRadius - g.minimumRootRadius).toFixed(3)} mm erhöhen.`);
      if (outer - inner < options.minWeb) errors.push(`${prefix}: Nabe oder Rand verkleinern; für Aussparungen bleibt zu wenig Platz.`);
      if (g.spokeWidth >= 2 * inner * Math.sin(Math.PI / g.spokes)) errors.push(`${prefix}: Speichenbreite oder Speichenanzahl verkleinern, alternativ Nabe vergrößern.`);
      if (inner > 0 && outer > inner && g.spokeWidth < 2 * inner * Math.sin(Math.PI / g.spokes)) {
        const first = windowFor(g, tolerance);
        g.windows = Array.from({ length: g.spokes }, (_, n) => first.map(p => rotate(p, TAU * n / g.spokes)));
        g.minimumHubWeb = Math.min(...first.map((p, i) => pointSegmentDistance([0, 0], p, first[(i + 1) % first.length]))) - g.bore / 2;
        if (g.minimumHubWeb < options.minWeb) errors.push(`${prefix}: Nabe etwas vergrößern; zum Achsenloch bleiben nur ${g.minimumHubWeb.toFixed(2)} mm Material.`);
        g.minimumSpokeWeb = polygonSeparation(g.windows[0], g.windows[1]);
        if (g.minimumSpokeWeb < options.minWeb + tolerance * 2) errors.push(`${prefix}: Speichen verbreitern oder Biegung verringern; der Materialsteg ist nur ${g.minimumSpokeWeb.toFixed(2)} mm breit.`);
      }
    }
    return g;
  });
  const [a, b] = model.gears;
  const centerDistance = a.pitchRadius + b.pitchRadius;
  const approach = Math.sqrt(b.activeRadius ** 2 - b.baseRadius ** 2) - b.pitchRadius * Math.sin(pressure);
  const recess = Math.sqrt(a.activeRadius ** 2 - a.baseRadius ** 2) - a.pitchRadius * Math.sin(pressure);
  const aStart = Math.sqrt(Math.max(0, a.rootRadius ** 2 - a.baseRadius ** 2)) - a.pitchRadius * Math.sin(pressure);
  const bEnd = b.pitchRadius * Math.sin(pressure) - Math.sqrt(Math.max(0, b.rootRadius ** 2 - b.baseRadius ** 2));
  const contactRatio = Math.max(0, Math.min(recess, bEnd) - Math.max(-approach, aStart)) / (Math.PI * options.module * Math.cos(pressure));
  model.metrics = { centerDistance, ratio: b.teeth / a.teeth, contactRatio, outerDiameters: model.gears.map(g => 2 * g.tipRadius) };
  const meshIssues = [];
  if (approach > a.pitchRadius * Math.sin(pressure) + EPS || recess > b.pitchRadius * Math.sin(pressure) + EPS) meshIssues.push('Das Paar berührt sich außerhalb des Evolventenbereichs. Eingriffswinkel oder Zähnezahl erhöhen, alternativ die Zahnhöhe verringern.');
  if (contactRatio < 1) meshIssues.push('Das Paar hat zu wenig Überdeckung. Zahnhöhe oder Zähnezahl erhöhen, alternativ einen kleineren Eingriffswinkel verwenden.');
  if (!errors.length && pairCollides(model)) meshIssues.push('Die Zahnkonturen überschneiden sich in der Drehprobe. Zahnspiel erhöhen, Zahnhöhe verringern oder ähnlichere Zähnezahlen verwenden.');
  model.meshValid = errors.length === 0 && meshIssues.length === 0;
  if (options.experimental) {
    warnings.push('Experimentelles freies Profil: Eine zuverlässige Kraftübertragung ist nicht zugesichert.', ...meshIssues);
  } else errors.push(...meshIssues);
  model.valid = errors.length === 0;
  return model;
}

export function placement(model, layout = 'pair', angle = 0) {
  const [a, b] = model.gears;
  if (!a || !b || !Number.isFinite(angle)) throw new Error('Keine gültige Zahnradgeometrie vorhanden.');
  let entries;
  if (layout === 'cut') entries = [{ gear: a, index: 0, x: 0, y: 0, angle: 0 }, { gear: b, index: 1, x: a.tipRadius + b.tipRadius + 5, y: 0, angle: 0 }];
  else if (layout === 'gear1' || layout === 'gear2') {
    const index = layout === 'gear1' ? 0 : 1;
    entries = [{ gear: model.gears[index], index, x: 0, y: 0, angle: 0 }];
  } else entries = [{ gear: a, index: 0, x: 0, y: 0, angle }, { gear: b, index: 1, x: model.metrics.centerDistance, y: 0, angle: Math.PI - Math.PI / b.teeth - angle * a.teeth / b.teeth }];
  const x = Math.min(...entries.map(e => e.x - e.gear.tipRadius));
  const y = Math.min(...entries.map(e => e.y - e.gear.tipRadius));
  return { entries, bounds: { x, y, width: Math.max(...entries.map(e => e.x + e.gear.tipRadius)) - x, height: Math.max(...entries.map(e => e.y + e.gear.tipRadius)) - y } };
}

// Outlines are polar-monotone, allowing logarithmic containment lookup.
function insideGear(point, g) {
  const radius = Math.hypot(...point);
  if (radius < g.minimumRootRadius - EPS) return true;
  if (radius >= g.tipRadius + EPS) return false;
  let angle = Math.atan2(point[1], point[0]);
  const start = Math.atan2(g.outline[0][1], g.outline[0][0]);
  while (angle < start) angle += TAU;
  const angleAt = index => {
    if (index === g.outline.length) return start + TAU;
    let a = Math.atan2(g.outline[index][1], g.outline[index][0]);
    if (a < start - EPS) a += TAU;
    return a;
  };
  let lo = 0, hi = g.outline.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (angleAt(mid) <= angle) lo = mid; else hi = mid;
  }
  const p = g.outline[lo], q = g.outline[hi % g.outline.length];
  return cross(p, q, point) > EPS;
}

export function pairCollides(model, samples = 48) {
  const [a, b] = model.gears;
  for (let step = 0; step < samples; step++) {
    const entries = placement(model, 'pair', TAU / a.teeth * step / samples).entries;
    const polygons = entries.map(e => e.gear.outline.map(p => { const v = rotate(p, e.angle); return [v[0] + e.x, v[1]]; }));
    for (let index = 0; index < 2; index++) {
      const other = entries[1 - index];
      for (const p of polygons[index]) {
        if (Math.hypot(p[0] - other.x, p[1]) >= other.gear.tipRadius + EPS) continue;
        if (insideGear(rotate([p[0] - other.x, p[1]], -other.angle), other.gear)) return true;
      }
    }
    // Restrict segment crossings to the small overlap of the two tip circles.
    const left = entries[1].x - b.tipRadius, right = a.tipRadius;
    const edges = polygons.map(points => points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length];
      return Math.max(p[0], q[0]) >= left && Math.min(p[0], q[0]) <= right ? [[p, q]] : [];
    }));
    for (const [p, q] of edges[0]) for (const [r, s] of edges[1]) {
      if (Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) < Math.min(p[1], q[1])) continue;
      if (crossing(p, q, r, s)) return true;
    }
  }
  return false;
}

const format = value => Number(value.toFixed(6)).toString();
export function pathData(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${format(p[0])} ${format(p[1])}`).join(' ') + ' Z';
}

export function exportSVG(model, target = 'pair') {
  if (!model?.valid || !['pair', 'gear1', 'gear2'].includes(target)) throw new Error('Export gesperrt: Bitte zuerst die Eingaben korrigieren.');
  const checked = buildModel(model.options);
  if (!checked.valid || JSON.stringify(checked.gears) !== JSON.stringify(model.gears) || JSON.stringify(checked.metrics) !== JSON.stringify(model.metrics)) throw new Error('Export gesperrt: Die Geometrie ist ungültig oder wurde verändert.');
  const { entries, bounds } = placement(checked, target === 'pair' ? 'cut' : target);
  const margin = .1;
  const width = bounds.width + 2 * margin, height = bounds.height + 2 * margin;
  const innerCuts = entries.map(({ gear, index, x }) => {
    const inner = [...(gear.bore > 0 ? [`<circle cx="0" cy="0" r="${format(gear.bore / 2)}"/>`] : []), ...gear.windows.map(p => `<path d="${pathData(p)}"/>`)];
    return `<g id="zahnrad-${index + 1}" transform="translate(${format(x)} 0)">\n${inner.join('\n')}\n</g>`;
  }).join('\n');
  const outerCuts = entries.map(({ gear, x }) => `<path d="${pathData(gear.outline)}" transform="translate(${format(x)} 0)"/>`).join('\n');
  const description = checked.options.experimental ? checked.warnings.join(' ') : 'Nominale Schnittmaße in Millimetern. Die reale Passung muss durch einen Probeschnitt geprüft werden.';
  const escapedDescription = description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}mm" height="${format(height)}mm" viewBox="${format(bounds.x - margin)} ${format(bounds.y - margin)} ${format(width)} ${format(height)}">\n<title>Zahnrad-Studio – Schnittkonturen</title>\n<desc>${escapedDescription}</desc>\n<g fill="none" stroke="${checked.options.cutColor}" stroke-width="0.1">\n<g id="innenschnitte">\n${innerCuts}\n</g>\n<g id="aussenkonturen">\n${outerCuts}\n</g>\n</g>\n</svg>\n`;
}
