// Requires the disposable same-origin proxy from problem-reports-integration.py.
export async function runProblemReportsArchiveBrowserTests(page, baseURL) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const checks = [];
  const archiveURL = baseURL + '/problem-reports/';
  const api = baseURL + '/problem-reports/api/reports';
  const malicious = '<img src="x" onerror="window.__reportXss=1"><svg onload="window.__reportXss=2"><script>window.__reportXss=3</script></svg>';
  await page.addInitScript(() => { window.__reportXss = 0; });

  await page.goto(archiveURL);
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Noch keine Meldungen eingegangen.');
  assert(await page.locator('#previous').isDisabled() && await page.locator('#next').isDisabled(), 'Empty archive pagination is enabled');
  checks.push('empty archive');
  await page.route('**/problem-reports/api/reports?*', route => route.fulfill({status:503, contentType:'application/json', body:'{"error":"Temporary storage failure"}'}));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('(503)'));
  assert(await page.locator('#previous').isDisabled() && await page.locator('#next').isDisabled(), 'Failed archive request enables pagination');
  await page.unroute('**/problem-reports/api/reports?*');
  checks.push('archive request failure');

  await page.goto(baseURL + '/klappkarten-studio/');
  await page.waitForSelector('#surfaceCanvas canvas', {timeout:30000});
  await page.waitForFunction(() => document.querySelector('#surfaceList').options.length > 0);
  // Capture a real studio document + WebGL preview, without replacing its report adapter.
  await page.evaluate(value => { window.WorkshopReports.record('error', value, {rawSvg:value}); }, malicious);
  const posted = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url() === baseURL + '/api/problem-reports') posted.push(request.postData()); });
  await page.locator('#problem-report-button').click();
  await page.locator('#problem-description').fill(malicious);
  assert(posted.length === 0, 'Opening the report dialog uploaded data before explicit send');
  await page.locator('#problem-report-send').click();
  await page.waitForFunction(() => document.querySelector('#problem-report-status').textContent.includes('Dein Bericht bleibt erhalten.'));
  assert(posted.length === 1, 'First report submission did not occur exactly once');
  const submitted = JSON.parse(posted[0]);
  assert(submitted.app === 'klappkarten-studio', 'Real studio report has wrong app');
  assert(submitted.snapshot.state.document.surface.shapes.length > 0, 'Real studio source document is missing');
  assert(submitted.preview?.startsWith('data:image/png;base64,'), 'Real studio preview is missing');
  assert(submitted.preview.length > 1000, 'Real studio PNG is unexpectedly empty');
  const savedAfterFailure = await (await page.request.get(api)).json();
  assert(savedAfterFailure.total === 1, 'Ambiguous network result did not persist one report');
  assert(await page.locator('#problem-description').getAttribute('readonly') !== null, 'Ambiguous failure allows changing already stored content');
  checks.push('real Klappkarten capture + PNG stored before lost receipt');

  const [fallback] = await Promise.all([page.waitForEvent('download'), page.locator('#problem-report-download').click()]);
  let fallbackBody = '';
  for await (const chunk of await fallback.createReadStream()) fallbackBody += chunk.toString('utf8');
  assert(JSON.stringify(JSON.parse(fallbackBody)) === JSON.stringify(submitted), 'Fallback download changed the submitted report');
  await page.locator('#problem-report-send').click();
  await page.waitForFunction(() => document.querySelector('#problem-report-status').textContent.includes('Gespeichert als Bericht'));
  assert(posted.length === 2 && posted[0] === posted[1], 'Retry changed the frozen request');
  const listing = await (await page.request.get(api)).json();
  assert(listing.total === 1 && listing.reports[0].id === submitted.id, 'Retry created a duplicate report');
  checks.push('unchanged retry idempotency + retained download');

  await page.goto(archiveURL);
  await page.locator('.report').first().click();
  await page.waitForFunction(() => !document.querySelector('#detail').hidden);
  assert(await page.locator('#description').textContent() === malicious, 'Archive changed the literal report description');
  assert((await page.locator('#data').textContent()).includes(malicious.replaceAll('"', '\\"')), 'Raw SVG diagnostic is missing from the archive');
  assert(await page.locator('#detail svg,#detail script,#detail iframe,#detail img:not(#preview)').count() === 0, 'Report content created executable DOM');
  assert(await page.evaluate(() => window.__reportXss) === 0, 'Archived report content executed');
  await page.waitForFunction(() => document.querySelector('#preview').complete && document.querySelector('#preview').naturalWidth > 0);
  const pngResponse = await page.request.get(api + '/' + submitted.id + '/preview');
  const pngBody = await pngResponse.body();
  assert(pngResponse.status() === 200 && pngResponse.headers()['content-type'] === 'image/png', 'Archive preview was not served as PNG');
  assert(pngBody.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Archive preview has invalid PNG signature');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  let body = '';
  for await (const chunk of await download.createReadStream()) body += chunk.toString('utf8');
  const stored = JSON.parse(body);
  assert(stored.id === submitted.id && stored.number === listing.reports[0].number && stored.createdAt, 'Archive download metadata is missing');
  const {number, createdAt, ...original} = stored;
  assert(stable(original) === stable(submitted), 'Archive download changed the complete original report');
  assert(original.preview === submitted.preview && original.description === submitted.description, 'Archive download changed source data');
  checks.push('archive detail + safe literal SVG/text + API PNG + complete JSON download');

  return {passed:checks, id:submitted.id, reportNumber:stored.number, previewBytes:pngBody.length};
}
