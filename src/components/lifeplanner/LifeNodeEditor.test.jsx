import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createLifeNode } from '../../lifeplanner/entities.js';
import LifeNodeEditor from './LifeNodeEditor.jsx';
const en = JSON.parse(fs.readFileSync('public/locales/en/translation.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('public/locales/zh-CN/translation.json', 'utf8'));
const noop = () => {};
async function render({ value = createLifeNode({id:'immutable-id', type:'vision', title:'展示名称'}), lang='zh-CN', stale=false, writable=true }={}) {
  const i18n = createInstance(); await i18n.init({lng:lang, resources:{en:{translation:en}, 'zh-CN':{translation:zh}}, interpolation:{escapeValue:false}});
  const row={entityId:value.id,id:'head',kind:'lifeNode',deleted:false,value};
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><LifeNodeEditor row={row} liveRow={stale?{...row,id:'remote'}:row} nodes={[value]} writable={writable} pending={false} onDirty={noop} onFocus={noop} onChild={noop} onClose={noop} onRefresh={noop}/></I18nextProvider>);
}
describe('unified planning editor presentation',()=>{
  it('offers the same four types plus untyped for every node',async()=>{
    const html=await render();
    for(const type of ['wish','vision','goal','project']) expect(html).toContain(`value="${type}"`);
    expect(html).toContain('value=""');expect(html).toContain('immutable-id');expect(html).not.toContain('lifeBoard.');
  });
  it('keeps stale revisions visible but disables mutation fields',async()=>{
    const html=await render({stale:true});expect(html).toContain('role="alert"');expect(html).toMatch(/<input[^>]*disabled/);expect(html).toContain('展示名称');
  });
  it('permits inspection while read-only without enabling edits',async()=>{
    const html=await render({writable:false,lang:'en'});expect(html).toMatch(/<textarea[^>]*disabled/);expect(html).toMatch(/type="submit" disabled/);expect(html).not.toContain('lifeBoard.');
  });
  it('explains the preserved legacy metric without replacing the display title',async()=>{
    const html=await render({value:createLifeNode({id:'v',type:'vision',title:'想成为优秀讲师',details:{vision:{title:'完成2次演讲'}}})});
    expect(html).toContain('想成为优秀讲师');expect(html).toContain('完成2次演讲');
  });
  it('keeps new locale keys and interpolation variables complete in all shipped languages',()=>{
    const keys=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?keys(v,`${p}${k}.`):[`${p}${k}`]).sort();
    for(const lang of fs.readdirSync('public/locales')){
      const path=`public/locales/${lang}/translation.json`;if(!fs.existsSync(path))continue;
      const bundle=JSON.parse(fs.readFileSync(path,'utf8')).lifeBoard;
      expect(keys(bundle)).toEqual(keys(en.lifeBoard));
      expect((JSON.stringify(bundle).match(/\{\{[^}]+\}\}/g)||[]).sort()).toEqual((JSON.stringify(en.lifeBoard).match(/\{\{[^}]+\}\}/g)||[]).sort());
    }
  });
});
