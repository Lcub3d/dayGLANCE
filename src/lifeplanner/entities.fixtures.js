import { createWish, createVision, defaultDocument } from './model.js';
export function sources() {
  const wish = createWish('Health & career', 'career', 'w');
  const vision = createVision('Publish 2 books, in 3 years', '2026-09-20', 'v');
  vision.steps = [{id:'z-first',value:1,amount:1,unit:'year',goalId:'g'}, {id:'a-second',value:2,amount:2,unit:'year'}];
  wish.visions = [vision];
  return { document: { ...defaultDocument(['Be honest']), wishes:[wish] },
    goals:[{id:'g',title:'My edited goal',status:'active',description:'source notes',targetDate:'2027-09-20',custom:{unchanged:42},lifeplanner:{wishId:'w',visionId:'v',stepId:'z-first'}}],
    projects:[{id:'p',goalId:'g',title:'Draft project',status:'active',notes:'important',custom:[1,2]}] };
}
