"""Apply only the owner-approved Plan / Do terminology follow-up."""
import json
from pathlib import Path


def replace_once(path, before, after):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if text.count(before) != 1:
        raise RuntimeError(f'Unexpected source at {path}: {before!r}')
    file.write_text(text.replace(before, after), encoding='utf-8')


bundles = sorted(Path('public/locales').glob('*/translation.json'))
assert len(bundles) == 8
for file in bundles:
    bundle = json.loads(file.read_text(encoding='utf-8'))
    mobile = bundle['joboMobile']
    assert mobile['actual'] in ('Actual', '实际')
    mobile['view'] = f"{bundle['jobo']['plan']} / {bundle['jobo']['do']}"
    mobile['toggle'] = ('切换计划 / 执行与原始时间网格' if file.parent.name == 'zh-CN'
                        else 'Switch between Plan / Do and the original time grid')
    del mobile['actual']
    file.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

replace_once('src/components/jobo/MobileJoboView.jsx', "t('joboMobile.actual')", "t('jobo.do')")

doc = Path('docs/jobo-mobile-review.md')
text = doc.read_text(encoding='utf-8').replace('Plan / Actual', 'Plan / Do')
text = text.replace('Status: implementation branch for owner review. No pull request has been opened.',
                    'Status: owner-approved mobile follow-up for upstream review. This work depends on the Jobo foundation proposed in upstream PR #1673.')
text = text.replace('- Actual plus', '- Do plus').replace('Actual records use', 'Do records use')
text = text.replace('`scripts/jobo-mobile-review.py` against', '`scripts/jobo-mobile-recording-review.py` (including the base mobile suite) against')
text = text.replace('Owner visual approval is required before opening any PR.',
                    'The owner approved this layout for submission and requested the existing Plan / Do terminology. The mobile Do heading reuses `jobo.do`, matching desktop; the Chinese labels are 计划 / 执行. Locale and browser regressions check both language presentations.')
text = text.replace('`browser-review.json`,', '`browser-review.json`, `browser-review-extended.json`,')
doc.write_text(text, encoding='utf-8')

Path('src/utils/joboMobile.copy.test.js').write_text("""import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { languages, loaders } from '../locales.js';

describe('mobile Plan / Do terminology', () => {
  it.each(languages)('%s shares the desktop Plan / Do labels', async (language) => {
    const bundle = await loaders[language]();
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } } });
    expect(i18n.t('joboMobile.view')).toBe(`${i18n.t('jobo.plan')} / ${i18n.t('jobo.do')}`);
    expect(bundle.joboMobile).not.toHaveProperty('actual');
    expect(i18n.t('joboMobile.view')).not.toContain('Actual');
    expect(i18n.t('joboMobile.toggle')).not.toContain('Actual');
    expect(i18n.t('jobo.do')).toBe(language === 'zh-CN' ? '执行' : 'Do');
  });

  it('uses the shared Do heading instead of a separate Actual label', () => {
    const source = readFileSync(new URL('../components/jobo/MobileJoboView.jsx', import.meta.url), 'utf8');
    expect(source).toContain("<b>{t('jobo.do')}</b>");
    expect(source).not.toContain('joboMobile.actual');
  });
});
""", encoding='utf-8')

replace_once('scripts/jobo-mobile-recording-review.py', '    finally:\n', '''        def chinese_copy():
            expect(page.locator('.jobo-mobile-head b')).to_have_text(['计划', '执行'])
            expect(page.locator('.jobo-mobile-comparison')).to_have_attribute('aria-label', '计划 / 执行')
            expect(page.locator('[data-jobo-mobile-toggle]')).to_have_text('Plan / Do')
        check('Chinese comparison uses the shared Plan / Do labels', chinese_copy, page)

        def english_copy():
            page.evaluate("localStorage.setItem('i18nextLng', 'en')")
            page.reload(wait_until='networkidle')
            page.get_by_role('button').filter(has=page.get_by_text('Timeline', exact=True)).click()
            expect(page.locator('[data-jobo-mobile]')).to_be_visible()
            expect(page.locator('.jobo-mobile-head b')).to_have_text(['Plan', 'Do'])
            expect(page.locator('.jobo-mobile-comparison')).to_have_attribute('aria-label', 'Plan / Do')
            expect(page.locator('[data-jobo-mobile-toggle]')).to_have_attribute('aria-label', 'Switch between Plan / Do and the original time grid')
            base['shot'](page, 'mobile-english-plan-do')
        check('English heading and accessible labels use Plan / Do', english_copy, page)
    finally:
''')
print('Updated Plan / Do labels, review documentation and regression checks.')
