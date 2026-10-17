/* Loaded before application scripts so startup failures can also be reported. */
(() => {
  'use strict';
  const BUILD = document.querySelector('meta[name="workshop-build"]')?.content || 'werkstatt-reports-v1-20261016';
  const entries = [];
  let adapter, dialog, pending, previewReady, opening = false, sending = false;
  const stringify = value => JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) return { diagnosticNumber: String(item) };
    if (typeof item === 'bigint') return String(item);
    if (item instanceof Set) return [...item];
    if (item instanceof Map) return Object.fromEntries(item);
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
    return item;
  });
  function describe(value) {
    try { return (typeof value === 'string' ? value : stringify(value))?.slice(0, 4000) ?? String(value); }
    catch { return String(value).slice(0, 4000); }
  }
  function record(level, message, details) {
    entries.push({ at: new Date().toISOString(), level, message: describe(message), ...(details === undefined ? {} : { details: describe(details) }) });
    if (entries.length > 100) entries.shift();
  }
  window.WorkshopReports = { register(context) { adapter = context; }, record, build: BUILD };
  window.addEventListener('error', event => record('error', event.message || 'Ressource konnte nicht geladen werden.', event.error || event.target?.tagName), true);
  window.addEventListener('unhandledrejection', event => record('error', 'Unbehandelte Promise-Ablehnung', event.reason));
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { record(level, args.map(describe).join(' ')); original(...args); };
  }
  // Modal focus must not commit/repair the input that is being reported.
  document.addEventListener('change', event => { if (opening && !dialog?.contains(event.target)) event.stopImmediatePropagation(); }, true);

  function rawInputs() {
    return [...document.querySelectorAll('input,select,textarea,[contenteditable="true"]')]
      .filter(el => !el.closest('[data-problem-reporter]') && !['password', 'hidden', 'file'].includes(el.type) && !/password|passwd|secret|token|credential|authorization/i.test(el.name + ' ' + el.id + ' ' + el.autocomplete))
      .map((el, index) => ({ id: el.id || null, name: el.name || null, index, label: el.labels?.[0]?.textContent.trim() || el.getAttribute('aria-label'), type: el.type || el.tagName.toLowerCase(), value: el.isContentEditable ? el.textContent : el.value, ...(['checkbox', 'radio'].includes(el.type) ? { checked: el.checked } : {}), ...(el.validity ? { valid: el.validity.valid, validationMessage: el.validationMessage } : {}) }));
  }
  function png(canvas) {
    const copy = document.createElement('canvas'), scale = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
    copy.width = Math.max(1, Math.round(canvas.width * scale)); copy.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = copy.getContext('2d'); ctx.fillStyle = '#f6f6f0'; ctx.fillRect(0, 0, copy.width, copy.height); ctx.drawImage(canvas, 0, 0, copy.width, copy.height);
    const result = copy.toDataURL('image/png');
    if (result.length > 2 * 1024 * 1024 * 4 / 3) throw new Error('Das Vorschaubild ist größer als 2 MiB.');
    return result;
  }
  function capturePreview(node) {
    if (!node) return Promise.resolve(null);
    if (node instanceof HTMLCanvasElement) return Promise.resolve(png(node));
    if (node.namespaceURI !== 'http://www.w3.org/2000/svg' || node.localName !== 'svg') throw new Error('Keine unterstützte Vorschau verfügbar.');
    // Freeze the vector DOM now; never fetch resources from an imported SVG.
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script,foreignObject,iframe,object,embed,image,use,style').forEach(el => el.remove());
    for (const el of [clone, ...clone.querySelectorAll('*')]) for (const attr of [...el.attributes]) {
      const localPaint = /^url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)$/i.test(attr.value);
      if (/^on/i.test(attr.name) || /href$|^src$/i.test(attr.name) || /@import/i.test(attr.value) || (/url\s*\(/i.test(attr.value) && !localPaint)) el.removeAttribute(attr.name);
    }
    const box = node.getBoundingClientRect(), vb = node.viewBox?.baseVal;
    const width = Math.max(1, box.width || vb?.width || 800), height = Math.max(1, box.height || vb?.height || 600), scale = Math.min(1, 1280 / Math.max(width, height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', Math.round(width * scale)); clone.setAttribute('height', Math.round(height * scale));
    const frozen = new XMLSerializer().serializeToString(clone);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([frozen], { type: 'image/svg+xml' })), image = new Image();
      const timer = setTimeout(() => finish(new Error('Vorschaubild konnte nicht rechtzeitig erstellt werden.')), 4000);
      function finish(error) { clearTimeout(timer); URL.revokeObjectURL(url); image.onload = image.onerror = null; if (error) reject(error); }
      image.onload = () => { try { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); const result = png(canvas); finish(); resolve(result); } catch (error) { finish(error); } };
      image.onerror = () => finish(new Error('Vorschaubild konnte nicht erstellt werden.'));
      image.src = url;
    });
  }
  function freeze() {
    const missing = [];
    let state = {};
    if (adapter) { try { state = JSON.parse(stringify(adapter.capture())); } catch (error) { missing.push('Projektaufnahme fehlgeschlagen: ' + error.message); } }
    else if (document.body.dataset.app !== 'landing') missing.push('Die Anwendung hat noch keinen Projektzustand bereitgestellt.');
    const snapshot = { state, inputs: rawInputs(), status: [...document.querySelectorAll('[role="status"],#errors,#checks,#warnings')].map(el => ({ id: el.id, text: el.textContent.trim() })), scroll: { x: scrollX, y: scrollY }, activeInput: document.activeElement?.id || null };
    const report = { version: 1, id: crypto.randomUUID(), app: document.body.dataset.app || 'landing', capturedAt: new Date().toISOString(), description: '', snapshot, diagnostics: { entries: JSON.parse(stringify(entries)), incomplete: missing }, environment: { build: BUILD, pathname: location.pathname, browser: navigator.userAgent, language: navigator.language, viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio } } };
    let preview;
    try { preview = capturePreview(adapter?.preview?.()); }
    catch (error) { preview = Promise.reject(error); }
    previewReady = preview.then(value => { if (value) report.preview = value; else if (report.app !== 'landing') missing.push('Kein Vorschaubild verfügbar.'); }).catch(error => { missing.push(error.message); });
    return report;
  }
  function download(report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = `Problembericht-${report.app}-${report.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function init() {
    const button = document.createElement('button'); button.type = 'button'; button.id = 'problem-report-button'; button.dataset.problemReporter = ''; button.textContent = 'Problem melden';
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'problem-report-dialog');
    dialog = document.createElement('dialog'); dialog.id = 'problem-report-dialog'; dialog.dataset.problemReporter = ''; dialog.setAttribute('aria-labelledby', 'problem-report-title');
    dialog.innerHTML = '<form method="dialog"><h2 id="problem-report-title">Problem melden</h2><p>Dein aktueller Entwurf, offene Eingaben und vorhandene Fehlermeldungen werden als Momentaufnahme gesichert. Ein Vorschaubild kommt hinzu, soweit möglich.</p><label for="problem-description">Was ist passiert? <span>(optional)</span></label><textarea id="problem-description" maxlength="12000" rows="5" placeholder="Was wolltest du tun? Was hat nicht funktioniert?"></textarea><p class="report-note">Erst „Meldung senden“ überträgt diese Daten auf unseren Server. Füge bitte keine Passwörter hinzu.</p><p id="problem-report-status" role="status" aria-live="polite"></p><div class="report-actions"><button type="button" id="problem-report-send">Meldung senden</button><button type="button" id="problem-report-download">Bericht herunterladen</button><button type="submit" id="problem-report-close">Schließen</button></div></form>';
    document.body.append(button, dialog);
    const description = dialog.querySelector('textarea'), send = dialog.querySelector('#problem-report-send'), status = dialog.querySelector('#problem-report-status');
    let frozen, submission;
    button.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); if (!pending || (!submission && !sending)) frozen = freeze(); });
    button.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && (!pending || (!submission && !sending))) frozen = freeze(); });
    button.addEventListener('click', () => {
      if (!pending || (!submission && !sending)) {
        const unsentText = pending ? description.value : '';
        pending = frozen || freeze(); pending.description = unsentText; submission = null; description.readOnly = false; description.value = unsentText;
        delete dialog.dataset.saved; status.textContent = 'Momentaufnahme erstellt. Du kannst weitere Informationen ergänzen.'; send.disabled = false;
      }
      frozen = null; opening = true;
      try { dialog.showModal(); } finally { opening = false; }
    });
    description.addEventListener('input', () => { if (pending && !sending && !submission) pending.description = description.value; });
    // Studio shortcuts (notably Escape, which cancels drawings) must stay outside the dialog.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => { opening = true; try { button.focus(); } finally { opening = false; } });
    send.addEventListener('click', async () => {
      if (!pending || sending) return;
      sending = true; send.disabled = true; description.disabled = true; status.textContent = 'Meldung wird gespeichert …';
      const report = pending; if (!submission) report.description = description.value;
      await previewReady;
      submission ||= JSON.stringify(report); description.readOnly = true;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
      try {
        if (new Blob([submission]).size > 32 * 1024 * 1024) throw new Error('Der Bericht ist größer als 32 MiB und kann nur als Datei gesichert werden.');
        const response = await fetch('/api/problem-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: submission, signal: controller.signal, credentials: 'omit' });
        let result; try { result = await response.json(); } catch { throw new Error(response.status === 413 ? 'Der Bericht ist größer als das erlaubte Uploadlimit.' : 'Der Meldedienst ist hier nicht erreichbar (HTTP ' + response.status + ').'); }
        if (!response.ok) throw new Error(result.error || 'Der Meldedienst antwortet mit ' + response.status + '.');
        if (result.id !== report.id || !Number.isInteger(result.number)) throw new Error('Der Meldedienst hat die Speicherung nicht bestätigt.');
        status.textContent = `Gespeichert als Bericht № ${result.number}. Danke für die Meldung.`;
        pending = null; dialog.dataset.saved = 'true'; dialog._lastReport = report;
      } catch (error) {
        status.textContent = (error.name === 'AbortError' ? 'Die Übertragung hat zu lange gedauert.' : error.message) + ' Dein Bericht bleibt erhalten. Erneutes Senden verwendet denselben unveränderten Bericht. Du kannst ihn auch herunterladen.';
        send.disabled = false;
      } finally { clearTimeout(timeout); sending = false; description.disabled = false; }
    });
    dialog.querySelector('#problem-report-download').addEventListener('click', async () => { const report = pending || dialog._lastReport; if (!report) return; await previewReady; if (pending && !sending && !submission) report.description = description.value; download(submission ? JSON.parse(submission) : report); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
