from pathlib import Path
import os,json
root=Path(os.environ['JOBU_ROOT'])
p=root/'app/package.json'
d=json.loads(p.read_text());d['scripts']['audit:check']=d['scripts']['audit'];p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'browser.py';s=p.read_text();s=s.replace("page.locator('[data-life-wish]').filter(has_text='Publish a practical engineering handbook').wait_for()", "expect(page.locator('[data-life-wish] textarea').first).to_have_value('Publish a practical engineering handbook')");p.write_text(s)
