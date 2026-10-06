#!/usr/bin/env python3
"""Pack 22 importer helper: read ONE page of a PDF that has no text layer (the page is an image), with tesseract.

    python3 -I scripts/rules/ocr_page.py <file.pdf> <page>  ->  JSON on stdout

Output: the page text line by line (paragraphs separated by a blank line), tesseract's mean word confidence, per line its confidence, the
words read with low confidence (for review) and what the page image says about the line, and an estimate of whether the page carries
pictures (ink outside the text boxes), so the rules page can say "this part has pictures in the official document".

Layout facts are read from the page image, never guessed from the letters OCR produced:
- a bullet is a small square glyph at the start of a line followed by a wide gap; OCR reads it as "e", "o", "@", "co"... It is written as
  the glyph the document uses: filled "●" or hollow "○" (by how much of its box is ink);
- the coloured band printed at the left of headings and footers is a box of solid colour with no dark ink; OCR reads it as "_", "=", "7",
  "z=". It is left out of the text (listed under `dropped`);
- text inside a picture (a maker's logo, a museum copyright on a photo, a drawing's scribbles): `in_picture` gives the reason. The line
  stays in the text; the structurer sets it aside as furniture, and every such line is listed in the release review.
Needs: pdftoppm (poppler-utils), tesseract 5 with English, Pillow. Deterministic for a given file, page, tesseract version and resolution
(run with OMP_THREAD_LIMIT=1 for speed when several pages are read in parallel).
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

DPI = 300
LOW = 60          # a word under this confidence is "uncertain"
EDGE = 0.07       # ignore the top and bottom 7% (coloured header/footer bands) when looking for pictures
SMALL = 20        # px at 300 dpi: the document's smallest printed text (picture captions) is about 25 px tall; logo lettering is smaller


def box_stats(px, b):
    """Fractions of dark ink, near-white paper and saturated colour inside a box (sampled every 2 px)."""
    x0, y0, x1, y1 = b
    n = dark = white = sat = 0
    for y in range(y0, max(y1, y0 + 1), 2):
        for x in range(x0, max(x1, x0 + 1), 2):
            r, g, bl = px[x, y]
            mx, mn = max(r, g, bl), min(r, g, bl)
            n += 1
            if mx < 110:
                dark += 1
            elif mn > 225:
                white += 1
            if mx - mn > 60:
                sat += 1
    n = max(n, 1)
    return dark / n, white / n, sat / n


def main() -> None:
    pdf, page = sys.argv[1], int(sys.argv[2])
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / 'p'
        subprocess.run(['pdftoppm', '-r', str(DPI), '-png', '-f', str(page), '-l', str(page), '-singlefile', pdf, str(base)], check=True)
        png = f'{base}.png'
        tsv = subprocess.run(['tesseract', png, 'stdout', '--psm', '4', '-l', 'eng', 'tsv'], check=True, capture_output=True, text=True).stdout
        rgb = Image.open(png).convert('RGB')
        rgb.load()
    img = rgb.convert('L')
    cpx = rgb.load()
    w, h = img.size
    words, boxes = [], []
    for row in tsv.splitlines()[1:]:
        c = row.split('\t')
        if len(c) < 12 or c[0] != '5' or not c[11].strip():
            continue
        block, par, line = int(c[2]), int(c[3]), int(c[4])
        left, top, bw, bh, conf = int(c[6]), int(c[7]), int(c[8]), int(c[9]), float(c[10])
        b = (left, top, left + bw, top + bh)
        words.append({'key': (block, par, line), 'par': (block, par), 'text': c[11], 'conf': conf, 'box': b})
        boxes.append(b)
    lines = []
    current = None
    for wd in words:
        if current is None or wd['key'] != current['key']:
            current = {'key': wd['key'], 'par': wd['par'], 'words': []}
            lines.append(current)
        current['words'].append(wd)
    out, line_info, low_lines, prev_par = [], [], [], None
    for ln in lines:
        ws = ln['words']
        dropped = []
        # The coloured band: solid colour, no ink.
        keep = []
        for wd in ws:
            d, _, s = box_stats(cpx, wd['box'])
            if s >= 0.75 and d < 0.05:
                dropped.append(wd['text'])
            else:
                keep.append(wd)
        if not keep:
            # A line that is only the band: nothing to read.
            line_info.append({'text': '', 'dropped': dropped, 'skip': True})
            continue
        # A bullet: small, square, first on the line, a wide gap before the text.
        bullet = None
        if len(keep) > 1:
            f, nx = keep[0], keep[1]
            fw, fh = f['box'][2] - f['box'][0], f['box'][3] - f['box'][1]
            th = max(x['box'][3] - x['box'][1] for x in keep[1:])
            if abs(fw - fh) <= 3 and fh <= 0.75 * th and nx['box'][0] - f['box'][2] >= 1.5 * fw:
                d, _, _ = box_stats(cpx, f['box'])
                bullet = '●' if d >= 0.5 else '○'
        texts = [x['text'] for x in keep]
        raw = ' '.join(texts)
        if bullet:
            texts[0] = bullet
        text = ' '.join(texts)
        cs = [x['conf'] for x in keep if x['conf'] >= 0]
        body = keep[1:] if bullet else keep
        uncertain = [x['text'] for x in body if x['conf'] < LOW and any(ch.isalpha() for ch in x['text']) and len(x['text']) > 2]
        # Text inside a picture.
        lb = (min(x['box'][0] for x in keep), min(x['box'][1] for x in keep), max(x['box'][2] for x in keep), max(x['box'][3] for x in keep))
        _, white, _ = box_stats(cpx, lb)
        hs = sorted(x['box'][3] - x['box'][1] for x in body)
        mh = hs[len(hs) // 2]
        conf_mean = round(sum(cs) / len(cs), 1) if cs else 0
        # A readable word: two letters in a row, two digits, or a heading number. A drawing's marks read as lone letters and symbols.
        real = [x for x in body if re.search(r'[A-Za-z]{2}|\d\d', x['text']) or re.fullmatch(r'\d{1,3}(\.\d{1,3})*\.?', x['text'])]
        in_picture = None
        if mh < SMALL:
            in_picture = f'lettering {mh}px tall, smaller than any printed text'
        elif white < 0.45 and conf_mean < 70:
            in_picture = f'on a coloured or photographic background (paper {round(white * 100)}%), confidence {conf_mean}'
        elif not real:
            in_picture = 'no readable word: marks of a drawing'
        elif max(x['conf'] for x in body) < 40:
            in_picture = f'nothing read with confidence (best word {round(max(x["conf"] for x in body))}): marks of a picture'
        if prev_par is not None and ln['par'] != prev_par:
            out.append('')
        out.append(text)
        info = {'text': text, 'conf_mean': conf_mean, 'conf_min': round(min(cs), 1) if cs else 0, 'words': len(keep), 'uncertain': uncertain,
                'box': list(lb), 'paper': round(white, 2), 'height': mh}
        if raw != text:
            info['raw'] = raw
        if dropped:
            info['dropped'] = dropped
        if in_picture:
            info['in_picture'] = in_picture
        line_info.append(info)
        if uncertain and not in_picture:
            low_lines.append({'text': text, 'words': uncertain})
        prev_par = ln['par']
    line_info = [x for x in line_info if not x.get('skip')]
    confs = [x['conf'] for x in words if x['conf'] >= 0]
    # Pictures: dark pixels outside every word box, in the middle band of the page.
    px = img.load()
    mask_top, mask_bottom = int(h * EDGE), int(h * (1 - EDGE))
    step = 4
    inside = set()
    for (x0, y0, x1, y1) in boxes:
        for y in range(max(y0, 0) // step, min(y1, h) // step + 1):
            for x in range(max(x0, 0) // step, min(x1, w) // step + 1):
                inside.add((x, y))
    ink_out = total = 0
    for y in range(mask_top // step, mask_bottom // step):
        for x in range(0, w // step):
            total += 1
            if px[x * step, y * step] < 200 and (x, y) not in inside:
                ink_out += 1
    ratio = ink_out / total if total else 0
    print(json.dumps({
        'text': '\n'.join(out),
        'engine': 'tesseract ' + subprocess.run(['tesseract', '--version'], capture_output=True, text=True).stdout.splitlines()[0].split()[-1] + f' psm4 {DPI}dpi',
        'mean_conf': round(sum(confs) / len(confs), 1) if confs else None,
        'words': len(words),
        'low_lines': low_lines,
        'lines': line_info,
        'picture_ink_ratio': round(ratio, 4),
        'figures': ratio > 0.04,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
