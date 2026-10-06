import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeEntities, hostOf, parseRulesPage, slug } from './inventory';

const SNAP = 'rules-library/buhurt-international/snapshots/2026-10-06-rules-page.html.gz';
const committed = JSON.parse(readFileSync('rules-library/buhurt-international/source-inventory.json', 'utf8'));

describe('rules page inventory', () => {
  it('reads hosts and refs', () => {
    expect(hostOf('https://www.buhurtinternational.com/_files/ugd/d219c5_cd29c29d07894734abfd546ea3665066.pdf')).toEqual({ host: 'site_file', ref: 'd219c5_cd29c29d07894734abfd546ea3665066.pdf' });
    expect(hostOf('https://drive.google.com/file/d/1peAGsMBV8ldNkSlgR-U33V0JqCFYL8ja/view?usp=drive_link')).toEqual({ host: 'drive_file', ref: '1peAGsMBV8ldNkSlgR-U33V0JqCFYL8ja' });
    expect(hostOf('https://drive.google.com/drive/folders/1amr_AsH10QsnCOMjFB8ebcpUyUUp66yW?usp=drive_link')?.host).toBe('drive_folder');
    expect(hostOf('https://evil.example/_files/ugd/x.pdf')).toBeNull();
    expect(hostOf('https://buhurtinternational.com.evil.example/_files/ugd/x.pdf')).toBeNull();
    expect(hostOf('mailto:x@y')).toBeNull();
  });
  it('decodes entities and slugs labels', () => {
    expect(decodeEntities('Shields &amp; Bucklers')).toBe('Shields & Bucklers');
    expect(slug('Shields &amp; Bucklers')).toBe('shields-and-bucklers');
    expect(slug('Structure,Accreditation,Titles')).toBe('structure-accreditation-titles');
  });
  it('groups links by committee and heading, ignores navigation, and counts a file linked twice once', () => {
    const html = `<title>Rules</title><link rel="canonical" href="https://x.test/rules"/>
      <a href="https://www.buhurtinternational.com/_files/ugd/nav_1.pdf">Nav before any section</a>
      <p>Here you will find all the Documents that are approved by the Marshal committee (</p><p>MC)</p>
      <a href="https://drive.google.com/file/d/AAA/view"><span>Buhurt Rules</span></a>
      <a href="https://drive.google.com/file/d/AAA/view?usp=sharing">Buhurt Rules again</a>
      <p>Here you will find all the Documents that are approved by the Authenticity committee (AC)</p>
      <p>Helmets Requirements</p><a href="https://drive.google.com/file/d/BBB/view">Sallets</a>
      <a href="https://drive.google.com/drive/folders/CCC">Authenticity Archives</a>
      <p>Contact Us</p><a href="https://www.buhurtinternational.com/_files/ugd/after.pdf">After contact</a>`;
    const inv = parseRulesPage(html);
    expect(inv.page_url).toBe('https://x.test/rules');
    expect(inv.sections.map(s => s.key)).toEqual(['marshal', 'authenticity']);
    expect(inv.sections[0].intro).toBe('Here you will find all the Documents that are approved by the Marshal committee (MC)');
    expect(inv.documents.map(d => [d.key, d.heading, d.host])).toEqual([
      ['marshal/buhurt-rules', null, 'drive_file'],
      ['authenticity/sallets', 'Helmets Requirements', 'drive_file'],
      ['authenticity/authenticity-archives', null, 'drive_folder']
    ]);
  });
  it('rebuilds the committed Buhurt International inventory exactly from the committed snapshot', () => {
    const inv = parseRulesPage(gunzipSync(readFileSync(SNAP)).toString('utf8'));
    expect(inv.documents).toEqual(committed.documents);
    expect(inv.sections).toEqual(committed.sections);
    // The reconciliation numbers recorded in the Pack 22 report: 42 documents and 3 archive folders, every key unique, every link official.
    const docs = inv.documents.filter(d => d.host !== 'drive_folder');
    expect(docs).toHaveLength(42);
    expect(inv.documents.filter(d => d.host === 'drive_folder')).toHaveLength(3);
    expect(new Set(inv.documents.map(d => d.key)).size).toBe(inv.documents.length);
    expect(new Set(inv.documents.map(d => d.ref)).size).toBe(inv.documents.length);
    expect(Object.fromEntries(['executive', 'marshal', 'tournament', 'authenticity'].map(c => [c, docs.filter(d => d.committee === c).length]))).toEqual({ executive: 8, marshal: 6, tournament: 5, authenticity: 23 });
    for (const k of ['marshal/buhurt-rules', 'marshal/duels-rules', 'marshal/outrance-rules', 'tournament/buhurt-regulations', 'tournament/duel-regulations', 'authenticity/infractions', 'executive/judiciary-committee', 'executive/code-of-conduct'])
      expect(inv.documents.some(d => d.key === k), k).toBe(true);
  });
});
