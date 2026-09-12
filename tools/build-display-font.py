"""Rebuild the shipped display subset: fonttools[woff], full Reggae One TTF required.

Usage: python tools/build-display-font.py path/to/ReggaeOne-Regular.ttf
Runtime never downloads fonts from external services.
"""
import hashlib
import json
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
OUTPUT = ROOT / 'assets/fonts/reggae-one-display-v178.woff2'
font = TTFont(SOURCE, recalcTimestamp=False)
cmap = font.getBestCmap()
# Preserve every existing display glyph and cover shipped UI text, including
# dynamically selected boss/character names. Comments add harmless headroom.
characters = set(TTFont(ROOT / 'assets/fonts/reggae-one-display.woff2').getBestCmap())
inputs = sorted(set(
    list(ROOT.glob('*.html')) + list(ROOT.glob('*.js'))
    + list((ROOT / 'shared').glob('*.js'))
    + list((ROOT / 'generated').glob('*.js'))
    + list((ROOT / 'tools/stage-studio').glob('*.html'))
    + list((ROOT / 'tools/stage-studio').glob('*.js'))
))
for file in inputs:
    characters.update(map(ord, file.read_text(encoding='utf-8')))
characters.update(range(0x20, 0x7f))
included = sorted(characters.intersection(cmap))
options = subset.Options()
options.flavor = 'woff2'
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=included)
subsetter.subset(font)
font.flavor = 'woff2'
font.save(OUTPUT)
required = ['ショップ', '実績', '曜日迷宮', '大型ボス 共同討伐作戦',
            '鋼鉄要塞', '超大型要塞戦車', '雷晶龍ヴォルテリス', '雷雲の祭壇']
result = TTFont(OUTPUT).getBestCmap()
assert all(ord(char) in result for label in required for char in label)
metadata = {
    'source': 'https://github.com/google/fonts/tree/a90c1e388d5c5e577c01f30eb644b4fb47982fd0/ofl/reggaeone',
    'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'output': OUTPUT.relative_to(ROOT).as_posix(),
    'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
    'sizeBytes': OUTPUT.stat().st_size,
    'glyphCodepoints': len(result),
    'requiredLabels': required,
    'inputFiles': [file.relative_to(ROOT).as_posix() for file in inputs],
}
(ROOT / 'assets/fonts/display-font-manifest.json').write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: metadata[key] for key in ['sizeBytes', 'glyphCodepoints']}))
