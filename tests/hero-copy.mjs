import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {heroCopy} from '../website/shared/hero-copy-data.mjs';
import {selectVariant, applyHeroCopy} from '../website/shared/hero-copy.mjs';

const identities = ['landing','automaten-studio','baustein-studio','drehscheiben-studio','box-studio','klappkarten-studio','zahnrad-studio'];
assert.deepEqual(Object.keys(heroCopy).sort(), [...identities].sort());
const headlines = new Set();
const reference = /Minecraft|Tetris|Portal|Aperture|Hogwarts|Hobbit|Auenland|Mordor|Star Wars|Star-Wars|Padawan|R2-D2|Doctor Who|Doctor-Who|TARDIS|Zelda|Hyrule|Mario|Stargate|Star Trek|Star-Trek|Enterprise|Stardew Valley|Stardew-Valley|D&D|W20|Dune|Arrakis|Tron|Metroid/i;
for (const [identity,pool] of Object.entries(heroCopy)) {
  assert.equal(pool.length,30,`${identity}: expected 30 variants`);
  for (const copy of pool) {
    assert.deepEqual(Object.keys(copy),['eyebrow','headline','subline']);
    assert.match(Object.values(copy).join(' '),reference,`${identity}: each triple needs a recognizable nerd/pop-culture reference`);
    for (const text of Object.values(copy)) {
      assert.equal(typeof text,'string');
      assert.ok(text.trim().length > 10,`${identity}: empty or short copy`);
      assert.ok(!/[<>]/.test(text),'Copy must be plain text');
    }
    assert.ok(!headlines.has(copy.headline),`Duplicate headline: ${copy.headline}`);
    headlines.add(copy.headline);
  }
  assert.equal(selectVariant(pool,()=>0),pool[0]);
  assert.equal(selectVariant(pool,()=>0.999999),pool[29]);
  assert.equal(selectVariant(pool,()=>1),pool[29]);
}
assert.equal(selectVariant([],()=>0),undefined);
assert.equal(selectVariant(undefined),undefined);
// Minimal DOM doubles verify paired updates, unknown identities, and missing targets.
const targets = Object.fromEntries(['eyebrow','headline','subline'].map(key=>[`[data-hero-${key}]`,{textContent:'fallback'}]));
const hero={dataset:{hero:'landing'},querySelector:selector=>targets[selector]};
const unknown={dataset:{hero:'unknown'},querySelector:()=>{throw Error('Unknown pool must keep fallback');}};
const quote={dataset:{projectQuote:'box-studio'},textContent:'fallback'};
const unknownQuote={dataset:{projectQuote:'unknown'},textContent:'fallback'};
const root={querySelectorAll:selector=>selector==='[data-hero]'?[hero,unknown]:[quote,unknownQuote]};
applyHeroCopy(root,()=>0);
for (const key of ['eyebrow','headline','subline']) assert.equal(targets[`[data-hero-${key}]`].textContent,heroCopy.landing[0][key]);
assert.equal(quote.textContent,heroCopy['box-studio'][0].headline);
assert.equal(unknownQuote.textContent,'fallback');
hero.querySelector=()=>null;
applyHeroCopy(root,()=>0.5);
const landing=await readFile(new URL('../website/index.html',import.meta.url),'utf8');
const names=[...landing.matchAll(/<h3 id="project-\d"><a[^>]+>([^<]+)<\/a><\/h3>/g)].map(match=>match[1]);
assert.deepEqual(names,['Automaten-Studio','Baustein-Studio','Drehscheiben-Studio','Kästchen-Studio','Klappkarten-Studio','Zahnrad-Studio','LimeScope','Workshop-Zuordnung']);
assert.deepEqual([...landing.matchAll(/class="project-number">(\d+)/g)].map(match=>match[1]),['01','02','03','04','05','06','07','08']);
assert.equal((landing.match(/data-project-quote=/g)||[]).length,6);
assert.ok(landing.includes('data-app="landing"'));
assert.ok(landing.includes('src="./shared/problem-reporter.js"'));
assert.ok(landing.includes('href="./shared/problem-reporter.css"'));
console.log(`Hero copy passed: ${headlines.size} unique triples, paired rendering, fallbacks, and landing order.`);
