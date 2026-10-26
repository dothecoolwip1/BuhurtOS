#!/usr/bin/env python3
"""Derive every icon and share image from the brand masters in public/brand/ (needs Pillow: pip install pillow).

Run: python3 scripts/makeIcons.py
Masters (the source of truth, supplied by the owner, 2026-10-26):
  public/brand/crest.png        the shield crest alone, transparent
  public/brand/wordmark.png     crest + "BuhurtOS" lockup, transparent (the header logo)
  public/brand/badge.png        square badge with the wordmark, on black
  public/brand/badge-round.png  round badge, on black (the app icon)
  public/brand/banner.png       wide banner (the share image)
Outputs: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, favicon-48.png, favicon-32.png,
         og-default.png (1200x630), brand/crest.webp, brand/wordmark.webp.
"""
from pathlib import Path
from PIL import Image

PUB = Path(__file__).resolve().parent.parent / 'public'
BRAND = PUB / 'brand'
BLACK = (6, 5, 5)

def fit(im, size):
    im = im.copy(); im.thumbnail((size, size), Image.LANCZOS); return im

crest = Image.open(BRAND / 'crest.png').convert('RGBA')
wordmark = Image.open(BRAND / 'wordmark.png').convert('RGBA')
badge = Image.open(BRAND / 'badge-round.png').convert('RGB')
banner = Image.open(BRAND / 'banner.png').convert('RGB')

# App icons: the round badge is already full-bleed on black.
for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    fit(badge, size).save(PUB / name, optimize=True)

# Maskable: Android may crop to a circle of 80% of the width, so keep the badge inside that safe zone.
m = Image.new('RGB', (512, 512), BLACK)
inner = fit(badge, 410)
m.paste(inner, ((512 - inner.width) // 2, (512 - inner.height) // 2))
m.save(PUB / 'icon-maskable-512.png', optimize=True)

# Favicons: the crest alone reads best at tab size.
for name, size in (('favicon-48.png', 48), ('favicon-32.png', 32)):
    fit(crest, size).save(PUB / name, optimize=True)

# Share image 1200x630: the banner scaled to height, centred.
scale = 630 / banner.height
b = banner.resize((round(banner.width * scale), 630), Image.LANCZOS)
left = (b.width - 1200) // 2
b.crop((left, 0, left + 1200, 630)).save(PUB / 'og-default.png', optimize=True)

# Header assets (small, lossy, transparent).
fit(crest, 512).save(BRAND / 'crest.webp', quality=90, method=6)
w = wordmark.copy(); w.thumbnail((900, 900), Image.LANCZOS); w.save(BRAND / 'wordmark.webp', quality=90, method=6)
print('wrote icons, favicons, og-default.png and brand webp files')
