// Gemeinsame Bedienelemente: Studio-Umschalter und Hinweise auf gespeicherte Entwürfe.
// Ohne JavaScript bleiben die statischen Rückfall-Links im Markup nutzbar.
import {studios, hasDraft, editedKey} from './studios.mjs';

const svgNS = 'http://www.w3.org/2000/svg';

function icon(base, id) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ws-icon');
  const use = document.createElementNS(svgNS, 'use');
  use.setAttribute('href', `${base}shared/icons.svg#i-${id.replace('-studio', '')}`);
  svg.append(use);
  return svg;
}

export function buildSwitcher(details, base = '../') {
  const current = details.dataset.wsSwitcher;
  const menu = details.querySelector('.ws-menu');
  if (!menu) return;
  const list = document.createElement('ul');
  for (const studio of studios) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `${base}${studio.id}/`;
    link.dataset.studio = studio.id;
    if (studio.id === current) link.setAttribute('aria-current', 'page');
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = studio.name;
    const summary = document.createElement('small');
    summary.textContent = studio.summary;
    text.append(name, summary);
    link.append(icon(base, studio.id), text);
    if (studio.id !== current && hasDraft(studio)) {
      const badge = document.createElement('em');
      badge.className = 'ws-draft-dot';
      badge.title = 'Entwurf gespeichert';
      badge.textContent = 'Entwurf';
      link.append(badge);
    }
    item.append(link);
    list.append(item);
  }
  const all = document.createElement('a');
  all.className = 'ws-menu-all';
  all.href = `${base}#werkzeuge`;
  all.textContent = 'Alle Werkzeuge der Werkstatt';
  menu.replaceChildren(list, all);
  // Escape, Fokuswechsel und Klicks außerhalb schließen das Menü.
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape' && details.open) { details.open = false; details.querySelector('summary')?.focus(); }
  });
  // Ohne relatedTarget (z. B. Klick in Safari) schließt der pointerdown-Handler.
  details.addEventListener('focusout', event => { if (event.relatedTarget && !details.contains(event.relatedTarget)) details.open = false; });
  document.addEventListener('pointerdown', event => { if (details.open && !details.contains(event.target)) details.open = false; });
}

// Merkt sich, ob eine Eingabe das gespeicherte Projekt verändert hat.
export function trackEdits(studio, root = document, storage = globalThis.localStorage) {
  let baseline;
  const read = () => { try { return studio.storage.map(key => storage.getItem(key)).join('\u0000'); } catch { return ''; } };
  let timer;
  const commit = () => {
    if (baseline === undefined || read() === baseline) return;
    try { storage.setItem(editedKey(studio), '1'); } catch { /* Speicher gesperrt: kein Hinweis */ }
  };
  const arm = event => {
    if (!event.isTrusted || event.target?.closest?.('[data-problem-reporter],.ws-bar')) return;
    if (baseline === undefined) baseline = read();
    // Autosaves laufen teils verzögert; der Vergleich folgt kurz nach der Eingabe.
    clearTimeout(timer); timer = setTimeout(commit, 1500);
  };
  for (const type of ['pointerdown', 'keydown', 'input', 'change']) root.addEventListener(type, arm, true);
  addEventListener('pagehide', commit);
  root.addEventListener('visibilitychange', () => { if (root.visibilityState === 'hidden') commit(); });
  return commit;
}

export function markDrafts(root = document) {
  for (const card of root.querySelectorAll('[data-draft-studio]')) {
    const studio = studios.find(entry => entry.id === card.dataset.draftStudio);
    if (studio && hasDraft(studio)) card.classList.add('has-draft');
  }
}

if (typeof document !== 'undefined') {
  const base = document.querySelector('[data-ws-base]')?.dataset.wsBase ?? '../';
  for (const details of document.querySelectorAll('[data-ws-switcher]')) buildSwitcher(details, base);
  const current = studios.find(studio => studio.id === document.body.dataset.app);
  if (current?.storage.length) trackEdits(current);
  markDrafts();
}
