// Builds the invented example PDFs with Chromium (reproducible fixtures for the importer tests):
//   CHROME=/opt/pw-browsers/chromium node scripts/rules/fixtures/make-example-pdfs.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { DOCS, html, BANNER } from './example-docs.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();
for (const [key, doc] of Object.entries(DOCS)) {
  const [release, file] = key.split('/');
  const dir = `rules-library/_example-body/releases/${release}/sources`;
  mkdirSync(dir, { recursive: true });
  await page.setContent(html(doc));
  await page.pdf({ path: `${dir}/${file}.pdf`, format: 'A5', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }, displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8pt;width:100%;text-align:center">${BANNER}</div>`, footerTemplate: '<div style="font-size:8pt;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
  console.log('wrote', `${dir}/${file}.pdf`);
}
await browser.close();
