import {heroCopy} from './hero-copy-data.mjs';

export function selectVariant(pool, random = Math.random) {
  if (!pool?.length) return undefined;
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}

export function applyHeroCopy(root = document, random = Math.random) {
  for (const hero of root.querySelectorAll('[data-hero]')) {
    const copy = selectVariant(heroCopy[hero.dataset.hero], random);
    if (!copy) continue;
    for (const key of ['eyebrow', 'headline', 'subline']) {
      const target = hero.querySelector(`[data-hero-${key}]`);
      if (target) target.textContent = copy[key];
    }
  }
  for (const card of root.querySelectorAll('[data-project-quote]')) {
    const copy = selectVariant(heroCopy[card.dataset.projectQuote], random);
    if (copy) card.textContent = copy.headline;
  }
}

if (typeof document !== 'undefined') applyHeroCopy();
