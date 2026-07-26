"""index.html の <script> から、宣言が見つからない大文字識別子を洗い出す。
STAGE_H のような「実行されるまで気付けない未定義参照」を静的に拾うのが目的。"""
import io, re, sys

path = 'C:/Users/futsa/OneDrive/デスクトップ/業務効率化/カタモン/index.html'
src = io.open(path, encoding='utf-8').read()
script = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', src, re.S)[0]

# コメントと文字列リテラルを潰してから走査する
body = re.sub(r'//[^\n]*', '', script)
body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
for pat in [r'`(?:[^`\\]|\\.)*`', r"'(?:[^'\\\n]|\\.)*'", r'"(?:[^"\\\n]|\\.)*"']:
    body = re.sub(pat, ' "" ', body)

ident = r'\b[A-Z][A-Z0-9_]{2,}\b'
used = set(re.findall(ident, body))
declared = set(re.findall(r'(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]{2,})\b', body))
# 分割代入とプロパティ参照は別物なので除外する
declared |= set(re.findall(r'([A-Z][A-Z0-9_]{2,})\s*(?:=|,)', body)) & used
props = set(re.findall(r'\.\s*([A-Z][A-Z0-9_]{2,})\b', body))
keys = set(re.findall(r'([A-Z][A-Z0-9_]{2,})\s*:', body))
builtin = {'NaN', 'JSON', 'URL', 'GET', 'PUT', 'POST', 'DELETE'}

missing = sorted(used - declared - props - keys - builtin)
print('宣言が見つからない大文字識別子:')
if not missing:
    print('  なし')
for m in missing:
    lines = [i + 1 for i, line in enumerate(script.split('\n')) if re.search(r'\b' + m + r'\b', line)]
    print('  %-26s 出現 %d 箇所  script内行: %s' % (m, len(lines), lines[:6]))
sys.exit(1 if missing else 0)
