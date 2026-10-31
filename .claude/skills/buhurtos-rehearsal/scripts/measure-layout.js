// Read-only layout measurement for a BuhurtOS rehearsal. Paste into the DevTools console of the page under test (or pass the function body to the
// browser-control tool's evaluate). It changes nothing, sends nothing and reads no storage. Copy the printed JSON into measurements.json, adding
// step, screen, utc and build. Text is cut to 40 characters and anything that looks like a code, token or link is replaced, so it is safe to save.
(() => {
  const MIN = 44;
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    .replace(/https?:\/\/\S+/g, '[link]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]').replace(/\b\d{6,}\b/g, '[code]').replace(/\S+@\S+/g, '[email]');
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // A label wrapping or pointing at a checkbox/radio is the tappable area, so measure the label instead of the tiny input.
  const target = (e) => (e.matches('input[type=checkbox],input[type=radio]') && (e.closest('label') || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)))) || e;
  const seen = new Set(); const targets = [];
  for (const e of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[tabindex]:not([tabindex="-1"])')) {
    const t = target(e); if (seen.has(t) || !visible(t)) continue; seen.add(t);
    const r = t.getBoundingClientRect();
    targets.push({ text: clean(t.getAttribute('aria-label') || t.innerText || t.value || t.getAttribute('title')), tag: t.tagName.toLowerCase(),
      height: Math.round(r.height * 10) / 10, width: Math.round(r.width * 10) / 10, top: Math.round(r.top), inBottomHalf: r.top >= innerHeight / 2,
      clippedRight: r.right > innerWidth + 0.5, disabled: !!t.disabled });
  }
  const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]')].filter(visible).map((d) => {
    const r = d.getBoundingClientRect();
    return { label: clean(d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.innerText), fits: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5,
      height: Math.round(r.height), width: Math.round(r.width), focusInside: d.contains(document.activeElement) };
  });
  const se = document.scrollingElement;
  const out = { innerWidth, innerHeight, scrollWidth: se.scrollWidth, overflow: se.scrollWidth > innerWidth,
    hidden: document.hidden, visibilityState: document.visibilityState, minTarget: MIN,
    small: targets.filter((t) => t.height < MIN && !t.disabled), clipped: targets.filter((t) => t.clippedRight), dialogs, targets };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
