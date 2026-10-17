const $ = id => document.getElementById(id);
const names = { 'automaten-studio': 'Automaten-Studio', landing: 'Startseite', 'baustein-studio': 'Baustein-Studio', 'drehscheiben-studio': 'Drehscheiben-Studio', 'box-studio': 'Kästchen-Studio', 'klappkarten-studio': 'Klappkarten-Studio', 'zahnrad-studio': 'Zahnrad-Studio' };
let offset = 0, selection = 0;
const date = value => new Date(value).toLocaleString('de-DE');
async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Berichte konnten nicht geladen werden (${response.status}).`);
  return response.json();
}
async function show(id) {
  const token = ++selection;
  try {
    const report = await get('./api/reports/' + encodeURIComponent(id));
    if (token !== selection) return;
    $('detail-title').textContent = `Bericht № ${report.number} · ${names[report.app] || report.app}`;
    $('metadata').textContent = `Aufnahme: ${date(report.capturedAt)} · Gespeichert: ${date(report.createdAt)}`;
    $('description').textContent = report.description || 'Keine zusätzliche Beschreibung.';
    $('download').href = './api/reports/' + encodeURIComponent(id) + '/download';
    $('preview').hidden = !report.preview;
    if (report.preview) $('preview').src = './api/reports/' + encodeURIComponent(id) + '/preview'; else $('preview').removeAttribute('src');
    const { preview, ...data } = report;
    $('data').textContent = JSON.stringify(data, null, 2);
    $('detail').hidden = false; $('detail-title').focus();
  } catch (error) { if (token === selection) $('status').textContent = error.message; }
}
async function list() {
  $('previous').disabled = $('next').disabled = true;
  try {
    const result = await get(`./api/reports?limit=50&offset=${offset}`);
    $('list').replaceChildren();
    for (const report of result.reports) {
      const button = document.createElement('button'), title = document.createElement('strong'), meta = document.createElement('span'), text = document.createElement('span');
      button.className = 'report'; title.textContent = `№ ${report.number} · ${names[report.app] || report.app}`;
      meta.textContent = date(report.createdAt) + (report.hasPreview ? ' · Mit Vorschaubild' : '');
      text.textContent = report.description || 'Keine zusätzliche Beschreibung.';
      button.append(title, meta, text); button.addEventListener('click', () => show(report.id)); $('list').append(button);
    }
    $('status').textContent = result.total ? `${result.total} Bericht${result.total === 1 ? '' : 'e'} · ${offset + 1}–${offset + result.reports.length}` : 'Noch keine Meldungen eingegangen.';
    $('previous').disabled = offset === 0; $('next').disabled = offset + result.reports.length >= result.total;
  } catch (error) { $('status').textContent = error.message; }
}
$('previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); list(); });
$('next').addEventListener('click', () => { offset += 50; list(); });
list();
