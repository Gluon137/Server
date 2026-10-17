// Run through playwright-cli run-code with an isolated browser page.
export default async function checkProblemReporter(rootPage, base = 'http://127.0.0.1:8769') {
  const context = await rootPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), passed = [], errors = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/build', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Prüfdienst nicht erreichbar' }] }) }));
  const routes = ['/', '/automaten-studio/', '/baustein-studio/', '/drehscheiben-studio/', '/box-studio/', '/klappkarten-studio/', '/zahnrad-studio/'];
  try {
    for (const route of routes) {
      await page.goto(base + route);
      await page.locator('#problem-report-button').waitFor();
      if (route === '/drehscheiben-studio/') await page.waitForFunction(() => document.querySelector('#status')?.textContent && !document.querySelector('#status').textContent.includes('berechnet'));
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#problem-report-button').click();
        check(await page.locator('#problem-report-dialog').evaluate(el => el.open), route + ': dialog opens');
        const box = await page.locator('#problem-report-dialog').boundingBox();
        check(box.x >= 0 && box.x + box.width <= width + 1, route + ': dialog fits at ' + width);
        await page.locator('#problem-report-close').click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        check(!overflow, route + ': no horizontal overflow at ' + width);
        await page.screenshot({ path: `output/playwright/reports-${route.split('/')[1] || 'landing'}-${width}.png`, fullPage: width === 1440 });
      }
      // A fresh document makes the next snapshot independent of the layout sweep.
      await page.goto(base + route); await page.locator('#problem-report-button').waitFor();
      await page.setViewportSize({ width: 1440, height: 1100 });
      if (route !== '/') await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.WorkshopReports.record('warn', 'Gezielte Testwarnung');
        const input = document.createElement('input'); input.id = 'report-test-input'; input.value = 'unbestätigte Eingabe'; input.style.cssText = 'position:fixed;top:0;left:0;z-index:1001';
        input.addEventListener('change', () => { window.testUnexpectedCommit = true; });
        const password = document.createElement('input'); password.type = 'password'; password.id = 'report-test-password'; password.value = 'NEVER-IN-REPORT';
        document.body.append(input, password); input.focus();
      });
      await page.locator('#report-test-input').fill('noch nicht übernommen');
      await page.locator('#problem-report-button').click();
      check(!await page.evaluate(() => window.testUnexpectedCommit), route + ': opening must not commit active input');
      await page.locator('#problem-description').fill('Testmeldung <script>inert</script>');
      await page.locator('#problem-report-close').click();
      await page.evaluate(() => { document.querySelector('#report-test-input').value = 'vor dem Senden aktualisiert'; });
      await page.locator('#problem-report-button').click();
      check(await page.locator('#problem-description').inputValue() === 'Testmeldung <script>inert</script>', route + ': reopening an unsent report retains its text');
      let first, requests = 0;
      await page.route('**/api/problem-reports', async request => {
        requests++; const report = request.request().postDataJSON(); first ??= report;
        check(JSON.stringify(report) === JSON.stringify(first), route + ': retry keeps original snapshot');
        if (requests === 1) return request.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Testweise nicht verfügbar' }) });
        return request.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: report.id, number: 42, createdAt: new Date().toISOString() }) });
      });
      await page.locator('#problem-report-send').click();
      await page.waitForFunction(() => document.querySelector('#problem-report-status').textContent.includes('Dein Bericht bleibt erhalten'));
      check(first.app === (route.split('/')[1] || 'landing'), route + ': app identity');
      check(first.snapshot.inputs.some(input => input.id === 'report-test-input' && input.value === 'vor dem Senden aktualisiert'), route + ': reopening an unsent report captures fresh raw input');
      check(!JSON.stringify(first).includes('NEVER-IN-REPORT'), route + ': excludes passwords');
      check(first.diagnostics.entries.some(entry => entry.message === 'Gezielte Testwarnung'), route + ': includes warnings');
      check(await page.locator('#problem-description').evaluate(el => el.readOnly), route + ': ambiguous retry keeps description immutable');
      check(first.app === 'landing' || first.snapshot.state.document, route + ': includes app document');
      if (route === '/box-studio/' || route === '/baustein-studio/' || route === '/klappkarten-studio/') check(first.preview?.startsWith('data:image/png;base64,'), route + ': includes active PNG preview');
      const download = page.waitForEvent('download'); await page.locator('#problem-report-download').click();
      check((await download).suggestedFilename().endsWith('.json'), route + ': download on failed send');
      await page.evaluate(() => { document.querySelector('#report-test-input').value = 'später geändert'; });
      await page.locator('#problem-report-close').click(); await page.locator('#problem-report-button').click();
      check(await page.locator('#problem-description').inputValue() === 'Testmeldung <script>inert</script>', route + ': close/reopen retains description');
      await page.locator('#problem-report-send').click();
      await page.waitForFunction(() => document.querySelector('#problem-report-status').textContent.includes('№ 42'));
      await page.unroute('**/api/problem-reports'); passed.push(route);
    }
    for (const route of routes) {
      await page.goto(base + route); await page.setViewportSize({ width: 320, height: 1000 });
      const variantCheck = await page.evaluate(async () => {
        const { applyHeroCopy } = await import('/shared/hero-copy.mjs');
        for (let index = 0; index < 30; index++) {
          applyHeroCopy(document, () => (index + .1) / 30);
          if (document.documentElement.scrollWidth > innerWidth + 1) return { index, overflow: true };
        }
        return { count: 30, overflow: false };
      });
      check(!variantCheck.overflow, route + ': every variant fits 320px; failing index ' + variantCheck.index);
    }
    await page.goto(base + '/');
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"><defs><pattern id="report-test-grid" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#e51010"/></pattern></defs><rect width="2" height="2" fill="url(#report-test-grid)"/></svg>';
      document.body.append(host);
      window.WorkshopReports.register({ capture: () => ({}), preview: () => host.querySelector('svg') });
    });
    let svgReport;
    await page.route('**/api/problem-reports', route => {
      svgReport = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: svgReport.id, number: 43 }) });
    });
    await page.locator('#problem-report-button').click(); await page.locator('#problem-report-send').click();
    await page.waitForFunction(() => document.querySelector('#problem-report-status').textContent.includes('№ 43'));
    const pixel = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(0, 0, 1, 1).data];
    }, svgReport.preview);
    check(pixel[0] === 229 && pixel[1] === 16 && pixel[2] === 16, 'SVG preview preserves safe local pattern paint');
    await page.unroute('**/api/problem-reports');
    await page.goto(base + '/'); await page.locator('#problem-report-button').focus(); await page.keyboard.press('Enter');
    check(await page.locator('#problem-report-dialog').evaluate(el => el.open), 'keyboard activation');
    await page.keyboard.press('Escape'); check(!await page.locator('#problem-report-dialog').evaluate(el => el.open), 'Escape closes dialog');
    check(errors.length === 0, 'No page errors: ' + errors.join('; '));
    return { passed, widths: [1440, 390, 320] };
  } finally { await context.close(); }
}
