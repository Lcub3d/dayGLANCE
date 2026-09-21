// Synthetic review fixture, never imported by the application.
import { createWish, createVision, defaultDocument, validateDocument } from '../src/lifeplanner/model.js';
import { provenanceForStep } from '../src/lifeplanner/hierarchy.js';
const en = process.argv.includes('--en');
const wishes = [createWish(en ? 'Create work that matters' : '持续创作有价值的作品', 'creation', 'map-writing'),
  createWish(en ? 'Make lasting memories with my family' : '陪伴家人，留下一起经历的回忆', 'family', 'map-family')];
wishes[0].starred = true;
wishes[0].visions = [createVision(en ? 'Publish 2 books, within 3 years' : '出版2本书，3年内', '2026-09-21', 'map-books')];
wishes[0].visions[0].steps = [
  { id: 'map-first-book', value: 1, amount: 1, unit: 'year', goalId: 'life-goal-map-first-book', projectId: 'life-map-first-book' },
  { id: 'map-second-book', value: 2, amount: 2, unit: 'year' },
];
wishes[1].visions = [createVision(en ? 'Take 5 family trips, within 5 years' : '完成5次家庭旅行，5年内', '2026-09-21', 'map-trips')];
wishes[1].visions[0].steps = [{ id: 'map-first-trip', value: 1, amount: 1, unit: 'year', goalId: 'life-goal-map-first-trip', projectId: 'life-map-first-trip' }];
const goals = [], projects = [];
for (let i = 0; i < 2; i++) {
  const w=wishes[i], v=w.visions[0], s=v.steps[0];
  const base={status:'active',color:'bg-blue-500',createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z',...provenanceForStep(w,v,s)};
  goals.push({...base,id:s.goalId,title: en ? ['Finish the first book','Take our first trip'][i] : ['完成第一本书','完成第一次家庭旅行'][i],targetDate:'2027-09-21'});
  projects.push({...base,id:s.projectId,goalId:s.goalId,title:en ? ['A book of everyday observations','Plan a relaxed family trip'][i] : ['日常观察与写作计划','一次轻松的家庭旅行'][i]});
}
const task=(id,title,projectId,complete=false)=>({id,title,projectId,completed:complete,duration:30,color:'bg-blue-500',notes:'',subtasks:[],createdAt:'2026-09-21T00:00:00Z'});
const unscheduledTasks=[task('map-outline',en?'Draft the book outline':'写下这本书的大纲',projects[0].id),task('map-reading',en?'Organise reading notes':'整理已有阅读笔记',projects[0].id,true),task('map-destination',en?'Choose a destination together':'和家人一起确定目的地',projects[1].id),task('map-weekend',en?'Set aside a weekend':'留出一个周末',projects[1].id),task('map-unlinked',en?'An idea for later':'一个尚未安排的想法',null)];
console.log(JSON.stringify({document:validateDocument({...defaultDocument(['把时间留给真正重要的事。']),wishes}),goals,projects,tasks:[],unscheduledTasks,recurringTasks:[]}));
