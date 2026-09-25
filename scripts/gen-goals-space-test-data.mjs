#!/usr/bin/env node
// Generates a dayGLANCE backup file with rich Goals & Projects test data for
// exercising the Goals & Projects space (docs/goals-space-spec.md) without
// touching real data or any sync.
//
//   node scripts/gen-goals-space-test-data.mjs [out.json]
//
// Default output: docs/fixtures/goals-space-test-data.json. Restore it through
// the Backup menu (header Save icon → Restore) on a THROWAWAY profile: restore
// replaces tasks, inbox, goals, projects and areas and then reloads the app.
// Every date is relative to the day the script runs, so regenerate it when the
// "days left", "overdue" and "stalled" states have drifted.
//
// What the data covers (see docs/fixtures/goals-space-test-data.md for the
// checklist it is built for):
//   - 4 areas, in a deliberate order, one of them empty ("Home"), and one goal
//     with no area at all (the "No Defined Area" filter value)
//   - 9 goals: active with 0, 1, 2 and 5 projects, overdue, due in 3 days
//     (urgent amber), completed (every project done), no target date, a stalled
//     child with hideStalled ON vs OFF, one linked to lifeGLANCE, one archived
//   - 7 standalone projects: 0 tasks, 1 task, many tasks (with "N more"),
//     completed, detailsHidden (eyeball), an Obsidian note badge + a missing
//     note, one archived, one with an on-demand hyperGLANCE session TODAY and
//     one with a recurring session on weekdays
//   - tasks: scheduled (today/yesterday/next week) and inbox, with notes,
//     subtasks, #tags, a [[wikilink]], deadlines, priorities, durations that
//     skew the weighted progress, an archived task, and a recurring series
//     tied to a project
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const now = new Date();
const iso = (d) => d.toISOString();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
const day = (n) => ymd(daysFromNow(n));     // YYYY-MM-DD, n days from today
const stamp = (n) => iso(daysFromNow(n));   // ISO timestamp, n days from today
const today = day(0);

let seq = 0;
const id = (prefix) => `gs-${prefix}-${String(++seq).padStart(3, '0')}`;

// ── Areas ────────────────────────────────────────────────────────────────────
const area = (name, color, order) => ({ id: id('area'), name, color, order, createdAt: stamp(-120), updatedAt: stamp(-120) });
const areaDev = area('App Development', 'bg-orange-500', 0);
const areaMoney = area('Money / Finance', 'bg-green-500', 10);
const areaHealth = area('Health', 'bg-pink-500', 20);
const areaHome = area('Home', 'bg-teal-500', 30); // no goals: shows up only in the filter and Manage Areas
const areas = [areaDev, areaMoney, areaHealth, areaHome];

// ── Goals ────────────────────────────────────────────────────────────────────
const goal = (fields) => ({
  id: id('goal'), status: 'active', createdAt: stamp(-90), updatedAt: stamp(-1), ...fields,
});
const gIos = goal({
  title: 'Ship iOS Apps (lifeGLANCE and lastGLANCE)',
  description: 'Both apps in the App Store before the holiday freeze. Billing first, then store listings.',
  color: 'bg-green-500', areaId: areaDev.id, startDate: day(-60), targetDate: day(40),
});
const gElectron = goal({
  title: 'Ship Electron Apps (lifeGLANCE and lastGLANCE)',
  description: 'Desktop builds signed and notarised for macOS and Windows.',
  color: 'bg-purple-500', areaId: areaDev.id, startDate: day(-20), targetDate: day(105),
});
const gVault = goal({
  title: 'GLANCEvault Pro launch',
  description: 'Five projects, a mix of done and in flight — the widest card row.',
  color: 'bg-indigo-500', areaId: areaDev.id, startDate: day(-100), targetDate: day(200),
  obsidianNotePath: 'Goals/GLANCEvault Pro.md',
});
const gOverdue = goal({
  title: 'Migrate the blog off WordPress',
  description: 'Target date has passed with work still open: the overdue state (amber "Nd overdue", caution triangle).',
  color: 'bg-red-500', areaId: areaDev.id, startDate: day(-200), targetDate: day(-12),
});
const gEmergency = goal({
  title: 'Build a 6-month emergency fund',
  description: 'Due in three days: the urgent (amber) days-left label.',
  color: 'bg-yellow-500', areaId: areaMoney.id, startDate: day(-180), targetDate: day(3),
});
const gTaxes = goal({
  title: 'File 2025 taxes',
  description: 'Every project complete, goal marked completed: sorts first, renders at 45% opacity.',
  color: 'bg-teal-500', areaId: areaMoney.id, status: 'completed', startDate: day(-150), targetDate: day(-30), updatedAt: stamp(-25),
});
const gHalf = goal({
  title: 'Run a half marathon',
  description: 'No target date, and Stalled flags hidden for this goal (hideStalled) even though "Base mileage" qualifies as stalled.',
  color: 'bg-pink-500', areaId: areaHealth.id, startDate: day(-45), hideStalled: true,
});
const gPiano = goal({
  title: 'Learn piano: play one full piece',
  description: 'No area (the "No Defined Area" filter). Linked with lifeGLANCE (chain icon). No projects yet: the empty state.',
  color: 'bg-blue-500', startDate: day(-10), targetDate: day(300), synced_to_lifeglance: true,
});
const gArchived = goal({
  title: 'Old 2024 side hustle',
  color: 'bg-orange-500', areaId: areaMoney.id, status: 'archived', targetDate: day(-400), updatedAt: stamp(-300),
});
const goals = [gIos, gElectron, gVault, gOverdue, gEmergency, gTaxes, gHalf, gPiano, gArchived];

// ── Projects ─────────────────────────────────────────────────────────────────
const project = (fields) => ({
  id: id('proj'), status: 'active', createdAt: stamp(-30), updatedAt: stamp(-1), ...fields,
});
// Ship iOS Apps — 4 projects: 2 active (one has notes on tasks), 1 with no tasks, 1 completed
const pAsc = project({ title: 'App Store Connect', goalId: gIos.id, color: 'bg-purple-500', sortOrder: 0,
  description: 'Screenshots, listing copy, review notes. Blocked on final icon.' });
const pBilling = project({ title: 'Setup App Billing', goalId: gIos.id, color: 'bg-green-500', sortOrder: 10,
  description: 'RevenueCat + StoreKit 2.', obsidianNotePath: 'Projects/App Billing.md' });
const pLifeIos = project({ title: 'lifeGLANCE iOS', goalId: gIos.id, sortOrder: 20 }); // inherits the goal colour
const pLastIos = project({ title: 'lastGLANCE iOS', goalId: gIos.id, color: 'bg-teal-500', sortOrder: 30, status: 'completed', updatedAt: stamp(-3) });
// Ship Electron Apps — 1 project, freshly created (never stalled), with the on-demand hyperGLANCE session today
const pSigning = project({ title: 'Code signing & notarisation', goalId: gElectron.id, color: 'bg-indigo-500', sortOrder: 0, createdAt: stamp(-2),
  description: 'Developer ID cert, notarytool, Windows EV cert.',
  hyperglance: { enabled: true, icon: 'Code2', color: '#4f46e5', isRecurring: false, scheduledDays: [], scheduledDate: today,
    scheduledTime: '14:00', scheduledDuration: 90, templateTasks: [], completions: [], createdAt: stamp(-2) } });
// GLANCEvault Pro — 5 projects: 2 done, 2 in flight, 1 stalled (old, incomplete, nothing done in 7 days)
const pVaultSchema = project({ title: 'Vault schema v2', goalId: gVault.id, color: 'bg-indigo-500', sortOrder: 0, status: 'completed', updatedAt: stamp(-40) });
const pVaultBridge = project({ title: 'Obsidian bridge plugin', goalId: gVault.id, color: 'bg-purple-500', sortOrder: 10, status: 'completed', updatedAt: stamp(-15) });
const pVaultBilling = project({ title: 'Pro billing & licence keys', goalId: gVault.id, color: 'bg-green-500', sortOrder: 20, createdAt: stamp(-60),
  description: 'Stripe checkout → licence key → vault unlock.' });
const pVaultDocs = project({ title: 'Docs site', goalId: gVault.id, color: 'bg-blue-500', sortOrder: 30, createdAt: stamp(-45) });
const pVaultMarketing = project({ title: 'Launch marketing', goalId: gVault.id, color: 'bg-pink-500', sortOrder: 40, createdAt: stamp(-50),
  description: 'STALLED on purpose: 50 days old, open tasks, last completion 20 days ago.' });
// Migrate the blog (overdue goal) — 2 projects, one done
const pBlogExport = project({ title: 'Export posts to Markdown', goalId: gOverdue.id, color: 'bg-red-500', sortOrder: 0, status: 'completed', updatedAt: stamp(-20) });
const pBlogTheme = project({ title: 'Astro theme', goalId: gOverdue.id, color: 'bg-orange-500', sortOrder: 10, createdAt: stamp(-40) });
// Emergency fund — 2 projects, nearly there
const pBudget = project({ title: 'Monthly budget review', goalId: gEmergency.id, color: 'bg-yellow-500', sortOrder: 0, createdAt: stamp(-120) });
const pHysa = project({ title: 'Open a high-yield savings account', goalId: gEmergency.id, color: 'bg-green-500', sortOrder: 10, status: 'completed', updatedAt: stamp(-90) });
// File taxes (completed goal) — 2 projects, both done
const pGather = project({ title: 'Gather 1099s and receipts', goalId: gTaxes.id, color: 'bg-teal-500', sortOrder: 0, status: 'completed', updatedAt: stamp(-40) });
const pFile = project({ title: 'File with accountant', goalId: gTaxes.id, color: 'bg-blue-500', sortOrder: 10, status: 'completed', updatedAt: stamp(-25) });
// Half marathon — 2 projects, one stalled but the goal hides the flag; one with a recurring hyperGLANCE session
const pMileage = project({ title: 'Base mileage', goalId: gHalf.id, color: 'bg-pink-500', sortOrder: 0, createdAt: stamp(-45),
  description: 'Stalled by the rules, but the goal has hideStalled so no triangle shows.' });
const pStrength = project({ title: 'Strength & mobility', goalId: gHalf.id, color: 'bg-red-500', sortOrder: 10, createdAt: stamp(-45),
  hyperglance: { enabled: true, icon: 'Dumbbell', color: '#ec4899', isRecurring: true, scheduledDays: ['monday', 'wednesday', 'friday'], scheduledDate: null,
    scheduledTime: '07:00', scheduledDuration: 45,
    templateTasks: [{ id: id('tt'), name: 'Warm-up + mobility flow', notes: '10 min' }, { id: id('tt'), name: 'Main lifts', notes: 'squat / hinge / push / pull' }],
    completions: [{ date: day(-2), completedAt: stamp(-2) }], createdAt: stamp(-45) } });
// Standalone projects (7): the Projects tab
const sDayglance = project({ title: 'dayGLANCE', color: 'bg-orange-500', sortOrder: 0, createdAt: stamp(-300),
  description: 'The everyday backlog. Enough tasks to show the "N more" fold.', obsidianNotePath: 'Projects/dayGLANCE.md' });
const sLastglance = project({ title: 'lastGLANCE', color: 'bg-green-500', sortOrder: 10, createdAt: stamp(-200) });
const sGithub = project({ title: 'GitHub config', color: 'bg-pink-500', sortOrder: 20, createdAt: stamp(-10),
  description: 'No tasks at all: the card renders without count or progress.' });
const sDeadMoney = project({ title: 'Dead Money (novel)', color: 'bg-yellow-500', sortOrder: 30, createdAt: stamp(-80), detailsHidden: true,
  description: 'detailsHidden: the eyeball toggle hides task count, progress and completed tasks.',
  obsidianNotePath: 'Writing/Dead Money.md', obsidianNoteMissingAt: stamp(-1) });
const sEmployment = project({ title: 'Employment search', color: 'bg-indigo-500', sortOrder: 40, createdAt: stamp(-25) });
const sGarage = project({ title: 'Garage clear-out', color: 'bg-teal-500', sortOrder: 50, createdAt: stamp(-60), status: 'completed', updatedAt: stamp(-5) });
const sArchived = project({ title: 'Retired: Etsy shop', color: 'bg-red-500', sortOrder: 60, status: 'archived', createdAt: stamp(-400), updatedAt: stamp(-200) });
const projects = [
  pAsc, pBilling, pLifeIos, pLastIos, pSigning,
  pVaultSchema, pVaultBridge, pVaultBilling, pVaultDocs, pVaultMarketing,
  pBlogExport, pBlogTheme, pBudget, pHysa, pGather, pFile, pMileage, pStrength,
  sDayglance, sLastglance, sGithub, sDeadMoney, sEmployment, sGarage, sArchived,
];

// ── Tasks ────────────────────────────────────────────────────────────────────
// Scheduled tasks carry date/startTime/duration; inbox tasks carry no date.
// `doneDaysAgo` sets completed + completedAt (what the stalled rule reads).
const tasks = [];          // day-planner-tasks (scheduled)
const unscheduled = [];    // day-planner-unscheduled (inbox)
const projectColor = (p) => p.color || goals.find(g => g.id === p.goalId)?.color || 'bg-blue-500';
const task = (p, title, { duration = 30, doneDaysAgo = null, notes = '', subtasks = [], date = null, startTime = null, isAllDay = false, deadline, priority = 0, archived } = {}) => {
  const done = doneDaysAgo !== null;
  const t = {
    id: id('task'), title, duration, color: projectColor(p), completed: done, isAllDay,
    notes, subtasks: subtasks.map(s => ({ id: id('sub'), title: typeof s === 'string' ? s : s.title, completed: typeof s === 'string' ? false : !!s.completed })),
    priority, projectId: p.id,
    ...(done ? { completedAt: stamp(-doneDaysAgo) } : {}),
    ...(deadline ? { deadline } : {}),
    ...(archived ? { archived: true } : {}),
    lastModified: stamp(done ? -doneDaysAgo : -1),
  };
  if (date) { tasks.push({ ...t, date, startTime: isAllDay ? '00:00' : startTime }); }
  else unscheduled.push(t);
  return t;
};

// App Store Connect — 0/3, notes and subtasks
task(pAsc, 'Create iOS screenshots #design', { duration: 90, notes: 'Use the 6.7" and 6.1" sizes. Dark mode set too.\n\nSee the Figma frame "Store".',
  subtasks: ['Dashboard shot', 'Goals space shot', 'Widget shot'] });
task(pAsc, 'Write App Store listing copy', { duration: 60, notes: 'Keep the subtitle under 30 characters.' });
task(pAsc, 'Prepare review notes for App Review', { duration: 30, deadline: day(5), priority: 2 });
// Setup App Billing — 1/2, the completion is recent (not stalled); a scheduled task tomorrow
task(pBilling, 'IAP and subscription setup in App Store Connect', { duration: 60, doneDaysAgo: 2, notes: 'Done. Product ids: pro_monthly, pro_yearly.' });
task(pBilling, 'RevenueCat products and entitlements', { duration: 45, date: day(1), startTime: '10:00' });
// lifeGLANCE iOS — 1 task, scheduled today; wikilink in the title
task(pLifeIos, 'Verify iOS features against [[iOS checklist]]', { duration: 120, date: today, startTime: '13:00', priority: 1 });
// lastGLANCE iOS — completed project, all done
task(pLastIos, 'TestFlight build', { duration: 30, doneDaysAgo: 4 });
task(pLastIos, 'Submit for review', { duration: 15, doneDaysAgo: 3 });
// Code signing — brand new project, 1 open task with a deadline
task(pSigning, 'Request Developer ID certificate', { duration: 30, deadline: day(2), priority: 3, notes: 'Apple Developer → Certificates → Developer ID Application.' });
task(pSigning, 'Wire notarytool into the build', { duration: 60 });
// GLANCEvault Pro projects
task(pVaultSchema, 'Design the v2 record shape', { duration: 120, doneDaysAgo: 45 });
task(pVaultSchema, 'Migration from v1', { duration: 90, doneDaysAgo: 41 });
task(pVaultBridge, 'Plugin scaffolding', { duration: 60, doneDaysAgo: 30 });
task(pVaultBridge, 'Bridge scenario harness', { duration: 180, doneDaysAgo: 16, notes: 'Fake timers + stub vault. See CLAUDE.md.' });
task(pVaultBilling, 'Stripe checkout session', { duration: 60, doneDaysAgo: 1 });
task(pVaultBilling, 'Licence key generation #backend', { duration: 90, subtasks: [{ title: 'Choose signing scheme', completed: true }, 'Key format', 'Revocation list'] });
task(pVaultBilling, 'Unlock flow in the app', { duration: 60, date: day(3), startTime: '09:00' });
task(pVaultDocs, 'Docs site skeleton', { duration: 45, doneDaysAgo: 5 });
task(pVaultDocs, 'Write the sync guide', { duration: 120, notes: 'Cover: pairing, conflicts, the recycle bin rule.' });
task(pVaultMarketing, 'Landing page copy', { duration: 60, doneDaysAgo: 20 });
task(pVaultMarketing, 'Launch email sequence', { duration: 90 });
task(pVaultMarketing, 'Product Hunt assets', { duration: 60 });
// Blog migration (overdue goal)
task(pBlogExport, 'Run the WP → Markdown exporter', { duration: 30, doneDaysAgo: 22 });
task(pBlogExport, 'Fix image paths', { duration: 45, doneDaysAgo: 20 });
task(pBlogTheme, 'Pick a starter theme', { duration: 30, doneDaysAgo: 10 });
task(pBlogTheme, 'Port the header and footer', { duration: 90 });
task(pBlogTheme, 'Redirect map for old URLs', { duration: 60, deadline: day(-3), priority: 2, notes: 'Overdue deadline on an inbox task.' });
// Emergency fund
task(pBudget, 'September budget review', { duration: 30, doneDaysAgo: 1, date: day(-1), startTime: '19:00' });
task(pBudget, 'October budget review', { duration: 30, date: day(8), startTime: '19:00' });
task(pBudget, 'Cancel unused subscriptions', { duration: 20, doneDaysAgo: 30 });
task(pHysa, 'Compare HYSA rates', { duration: 30, doneDaysAgo: 95 });
task(pHysa, 'Open the account and set up auto-transfer', { duration: 30, doneDaysAgo: 90 });
// Taxes (all done)
task(pGather, 'Download 1099s', { duration: 20, doneDaysAgo: 50 });
task(pGather, 'Scan receipts', { duration: 60, doneDaysAgo: 42 });
task(pFile, 'Send the packet to the accountant', { duration: 15, doneDaysAgo: 30 });
task(pFile, 'Sign and file', { duration: 15, doneDaysAgo: 25 });
// Half marathon
task(pMileage, 'Week 1: 3 easy runs', { duration: 90, doneDaysAgo: 30 });
task(pMileage, 'Week 2: 3 easy runs + long run', { duration: 120 });
task(pMileage, 'Week 3: add strides', { duration: 120 });
task(pStrength, 'Book a mobility assessment', { duration: 30, doneDaysAgo: 2 });
task(pStrength, 'Buy a kettlebell', { duration: 15 });
// Standalone: dayGLANCE — many tasks, mixed states, tags and notes, one archived task
task(sDayglance, 'NEXT: Prepare for Obsidian plugin release #obsidian', { duration: 60, priority: 2, notes: 'Changelog, bump version, tag.' });
task(sDayglance, 'FEATURE: Goals & Projects space #goals', { duration: 240, doneDaysAgo: 0, notes: 'The thing being tested right now.' });
task(sDayglance, 'ENHANCE: Add alarm to Day Dial', { duration: 90 });
task(sDayglance, 'BUG: Widget refresh after midnight #widget', { duration: 45, priority: 3, deadline: day(1) });
task(sDayglance, 'Write release notes 5.4', { duration: 30, date: day(2), startTime: '16:00' });
task(sDayglance, 'Localise the space switcher strings', { duration: 30, doneDaysAgo: 1 });
task(sDayglance, 'Review dependabot PRs', { duration: 20 });
task(sDayglance, 'Refresh README screenshots', { duration: 45 });
task(sDayglance, 'Old: migrate to Vite 5', { duration: 60, doneDaysAgo: 200, archived: true });
// Standalone: lastGLANCE — 2 tasks
task(sLastglance, 'Redesign settings (cloud sync section)', { duration: 120, notes: 'Group by transport: WebDAV / iCloud / GLANCEvault.' });
task(sLastglance, 'TRMNL recipe (OG & X layouts)', { duration: 90, doneDaysAgo: 6 });
// Standalone: GitHub config — no tasks on purpose
// Standalone: Dead Money — detailsHidden, some done
task(sDeadMoney, 'Create character profiles #writing', { duration: 120, doneDaysAgo: 12, notes: 'Protagonist, antagonist, the sister.' });
task(sDeadMoney, 'Create location profiles #writing', { duration: 90 });
task(sDeadMoney, 'Develop the full plot outline', { duration: 180, subtasks: ['Act I', 'Act II', 'Act III'] });
// Standalone: Employment — inbox tasks with priorities and deadlines
task(sEmployment, 'Reach out to Major Lindsay', { duration: 15, priority: 3, deadline: today });
task(sEmployment, 'Contact Darren about the contract role', { duration: 15, priority: 1 });
task(sEmployment, 'Update résumé for platform roles', { duration: 60, doneDaysAgo: 3 });
task(sEmployment, 'Prep for the Thursday screen', { duration: 45, date: day(2), startTime: '11:00', isAllDay: false });
// Standalone: Garage clear-out — completed
task(sGarage, 'Sort into keep / donate / dump', { duration: 180, doneDaysAgo: 6 });
task(sGarage, 'Donation run', { duration: 60, doneDaysAgo: 5 });
// Archived project's task stays archived with it
task(sArchived, 'Close the shop', { duration: 30, doneDaysAgo: 200, archived: true });

// ── Recurring series tied to a project (the RecurringSeriesRow on its card) ──
const recurringTasks = [{
  id: id('rec'), title: 'Weekly vault sync check', startTime: '09:30', duration: 15, color: 'bg-green-500', isAllDay: false,
  notes: 'Confirm the bridge report and the licence server are green.', subtasks: [],
  recurrence: { type: 'weekly', daysOfWeek: [1], startDate: day(-28) },
  completedDates: [day(-7), day(-14)], exceptions: {}, projectId: pVaultBilling.id,
  createdAt: stamp(-28), lastModified: stamp(-7),
}];

// ── Backup envelope ──────────────────────────────────────────────────────────
const backup = {
  version: 1,
  exportedAt: iso(now),
  generatedBy: 'scripts/gen-goals-space-test-data.mjs',
  note: 'Synthetic Goals & Projects test data for docs/goals-space-spec.md. Restore on a throwaway profile only: it REPLACES tasks, inbox, goals, projects and areas.',
  data: {
    tasks,
    unscheduledTasks: unscheduled,
    recycleBin: [],
    recurringTasks,
    goals,
    projects,
    areas,
    goalsProjectsEnabled: true,
  },
};

// ── Sanity: the same rules the app applies, so the states above are real ─────
const allTasks = [...tasks, ...unscheduled];
const DEFAULT = 30;
const progressOf = (pid) => {
  const pt = allTasks.filter(t => t.projectId === pid && !t.archived);
  if (pt.length === 0) return null;
  const total = pt.reduce((s, t) => s + (t.duration || DEFAULT), 0);
  return pt.filter(t => t.completed).reduce((s, t) => s + (t.duration || DEFAULT), 0) / total;
};
const stalled = (p) => {
  if (Date.now() - new Date(p.createdAt).getTime() < 7 * 86400000) return false;
  const pt = allTasks.filter(t => t.projectId === p.id && !t.archived);
  if (!pt.some(t => !t.completed)) return false;
  const cutoff = day(-7);
  if (pt.some(t => t.completed && t.completedAt && t.completedAt >= cutoff)) return false;
  return !recurringTasks.some(t => t.projectId === p.id && (t.completedDates || []).some(d => d >= cutoff));
};
const assert = (cond, msg) => { if (!cond) throw new Error(`fixture invariant failed: ${msg}`); };
for (const p of projects.filter(p => p.status === 'completed')) assert(progressOf(p.id) === 1, `${p.title} is completed but not 100%`);
assert(stalled(pVaultMarketing), 'Launch marketing should be stalled');
assert(stalled(pMileage), 'Base mileage should be stalled (hidden by the goal)');
assert(!stalled(pSigning), 'Code signing is too new to be stalled');
assert(!stalled(pBilling), 'App Billing had a completion this week');
assert(progressOf(sGithub.id) === null, 'GitHub config must have no tasks');
assert(projects.filter(p => p.goalId === gVault.id).length === 5, 'GLANCEvault has 5 projects');
assert(projects.filter(p => p.goalId === gPiano.id).length === 0, 'Piano has no projects');

const out = resolve(process.argv[2] || 'docs/fixtures/goals-space-test-data.json');
writeFileSync(out, JSON.stringify(backup, null, 2) + '\n');
const standalone = projects.filter(p => !p.goalId && p.status !== 'archived').length;
console.log(`wrote ${out}: ${areas.length} areas, ${goals.length} goals, ${projects.length} projects (${standalone} standalone), ${tasks.length} scheduled + ${unscheduled.length} inbox tasks, ${recurringTasks.length} recurring series; dates relative to ${today}`);
