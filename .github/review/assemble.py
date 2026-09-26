"""Assemble an exact, reviewed tree; never modify settled Slice 2-4 files."""
import base64, hashlib, json, lzma, os, subprocess
from pathlib import Path
TOOLS = Path('/tmp/jobo-tools')
UP = '49b0a4b42c87a0be62970723c8bc869954bb4cd2'
OLD = 'f99f462064eb66a956de286f455ce146b2beecec'
def git(*args): return subprocess.check_output(['git', *args])
def checked_path(value):
 p = Path(value)
 assert not p.is_absolute() and '..' not in p.parts and '.git' not in p.parts, value
 return p
def digest(raw): return hashlib.sha256(raw).hexdigest() if raw is not None else None
encoded = ''.join((TOOLS / ('ops-%s.b64' % n)).read_text().strip() for n in (1,2,3))
raw = lzma.decompress(base64.b64decode(encoded, validate=True))
assert digest(raw) == '4f41c74517c2e493cd42f9404051333d07a08c6c4aab324fac35e8cbeba08d0e'
ops = json.loads(raw)
subprocess.run(['git', 'checkout', '--detach', UP], check=True)
for name in ops['overlay']:
 p = checked_path(name)
 data = git('show', OLD + ':' + name)
 if name.startswith('public/locales/'):
  doc = json.loads(git('show', UP + ':' + name))
  doc['jobo'] = json.loads(data)['jobo']
  data = (json.dumps(doc, ensure_ascii=False, indent=2)+'\n').encode()
 p.parent.mkdir(parents=True, exist_ok=True)
 p.write_bytes(data)
 mode = git('ls-tree', OLD, '--', name).decode().split()[0]
 p.chmod(0o755 if mode == '100755' else 0o644)
for item in ops['files']:
 p = checked_path(item['path'])
 before = p.read_bytes() if p.exists() else None
 assert digest(before) == item['before'], ('before',str(p),digest(before),item['before'])
 if item['after'] is None:
  p.unlink()
  continue
 if 'content' in item:
  after = item['content'].encode()
 else:
  lines = before.decode().splitlines(keepends=True)
  for start,end,text in reversed(item['edits']): lines[start:end] = text.splitlines(keepends=True)
  after = ''.join(lines).encode()
 assert digest(after) == item['after'], ('after',str(p),digest(after),item['after'])
 p.parent.mkdir(parents=True, exist_ok=True)
 p.write_bytes(after)
# Browser run 36269379943 exposed hover width changes moving an Untimed
# chip's Edit button away from the pointer. Reserve that chip's hit area.
p = Path('src/components/jobo/JoboView.css')
assert digest(p.read_bytes()) == '5eed16b557d140c360cfce66d12b5d0055957fcef5c305e8b6e6389cce3745d2'
c = p.read_text().replace('  .jobo-s5-untimed-card:not(:hover):not(:focus-within) .jobo-s5-do-actions,\n', '')
c += '\n/* Untimed chips keep a stable hit area as controls appear. A hover-driven\n   width change moves adjacent chips under the pointer and can make Edit\n   impossible to click. Timed cards have fixed timeline geometry. */\n.jobo-s5-untimed-card { flex: 0 0 260px; width: 260px; max-width: 100%; min-width: 0; }\n.jobo-s5-untimed-title { flex: 1; min-width: 0; }\n'
p.write_text(c)
assert digest(p.read_bytes()) == '50b2b1ce0b94497e137fd076d03c4117e441f8cfe14414fe454cd81578789a3d'
subprocess.run(['git','add','-A'],check=True)
settled = ['src/jobo/core.js','src/jobo/core.test.js','src/jobo/comparison.test.js','src/jobo/store.js','src/jobo/ledger.js','src/jobo/ledger.test.js','src/jobo/detector.js','src/jobo/detector.test.js','src/hooks/useJoboDetector.js','src/hooks/useJoboDetector.test.js','src/hooks/useJoboLedger.js','src/hooks/useUndo.js','src/utils/taskMutations.js','src/sync','src/mergeSync.js','package.json','package-lock.json','dayglance-android','dayglance-ios']
assert not git('diff','--cached','--name-only',UP,'--',*settled), 'Settled or unrelated source changed'
assert not git('diff','--cached','--name-only',UP,'--','.github'), 'Review infrastructure leaked into candidate'
Path('/tmp/jobo-results').mkdir(exist_ok=True)
Path('/tmp/jobo-results/candidate.diff').write_bytes(git('diff','--cached',UP))
Path('/tmp/jobo-results/candidate-tree.txt').write_bytes(git('write-tree'))
print('Candidate tree:',git('write-tree').decode().strip())
# Keep the browser runner independent of product code and its lockfile.
browser = TOOLS/'browser.py'
text = browser.read_text()
text = text.replace("name='编辑',exact=True", "name='编辑: 测试完成与补录',exact=True")
browser.write_text(text)
