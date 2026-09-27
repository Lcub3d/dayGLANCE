import React from 'react';
import {useDayPlannerCtx} from '../../context/DayPlannerContext.jsx';
export function FilterList(){return null;}
export default function TasksView(){const ctx=useDayPlannerCtx();return <section className="jobu-tasks"><h1>Tasks</h1>{[...(ctx.tasks||[]),...(ctx.unscheduledTasks||[])].filter(t=>!t.deleted).map(t=><p key={t.id}>{t.title}</p>)}</section>;}
