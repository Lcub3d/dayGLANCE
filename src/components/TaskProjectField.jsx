import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getProjectColor } from '../utils/colorUtils.js';
import { NEW_PROJECT_ID, newProjectFields } from '../utils/pendingProject.js';

/**
 * The task modals' project picker, desktop and phone: the active projects
 * grouped by goal, and "New project…", which turns the picker into a name
 * and an optional goal. That project is created when the task is saved
 * (utils/pendingProject.js).
 */
export default function TaskProjectField({ newTask, setNewTask }) {
  const { t } = useTranslation();
  const { darkMode, borderClass, textSecondary, hoverBg } = useDayPlannerCtx();
  const { goals, projects } = useFeaturesCtx();
  const fieldClass = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`;
  const activeGoals = goals.filter(g => g.status !== 'archived');

  // Copy-at-creation inheritance, as for an existing project: the new
  // project's colour and assigned users, from its goal, stamp the task.
  const pendingWith = (newProject) => {
    const goal = newProject.goalId ? goals.find(g => g.id === newProject.goalId) : null;
    const fields = newProjectFields({ title: newProject.title, goal });
    return { projectId: NEW_PROJECT_ID, newProject, color: fields.color, assignedUserSyncIds: fields.assignedUserSyncIds };
  };

  if (newTask.projectId === NEW_PROJECT_ID) {
    const pending = newTask.newProject || { title: '', goalId: '' };
    return (
      <div data-task-new-project className="space-y-2">
        <label className={`block text-sm ${textSecondary} mb-1`} htmlFor="task-new-project-name">{t('task.project')}</label>
        <div className="flex gap-2">
          <input
            id="task-new-project-name"
            autoFocus
            required
            value={pending.title}
            onChange={(e) => setNewTask({ ...newTask, newProject: { ...pending, title: e.target.value } })}
            placeholder={t('goals.projectTitlePlaceholder')}
            aria-label={t('task.newProjectName')}
            className={fieldClass}
          />
          <button
            type="button"
            data-task-new-project-cancel
            onClick={() => {
              const { newProject: _dropped, ...rest } = newTask;
              setNewTask({ ...rest, projectId: null, assignedUserSyncIds: [] });
            }}
            className={`flex-shrink-0 px-2 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg}`}
            aria-label={t('task.chooseExistingProject')}
            title={t('task.chooseExistingProject')}
          >
            <X size={16} />
          </button>
        </div>
        {activeGoals.length > 0 && (
          <select
            value={pending.goalId || ''}
            onChange={(e) => setNewTask({ ...newTask, ...pendingWith({ ...pending, goalId: e.target.value }) })}
            aria-label={t('goals.goalOptional')}
            className={fieldClass}
          >
            <option value="">{t('goals.noGoalStandalone')}</option>
            {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        )}
        <p className={`text-xs ${textSecondary}`}>{t('task.newProjectHint')}</p>
      </div>
    );
  }

  return (
    <div>
      <label className={`block text-sm ${textSecondary} mb-1`}>{t('task.project')}</label>
      <select
        value={newTask.projectId || ''}
        onChange={(e) => {
          if (e.target.value === NEW_PROJECT_ID) {
            setNewTask({ ...newTask, ...pendingWith({ title: '', goalId: '' }) });
            return;
          }
          const pid = e.target.value || null;
          const proj = pid ? projects.find(p => p.id === pid) : null;
          const parentGoal = proj?.goalId ? goals.find(g => g.id === proj.goalId) : null;
          // Copy-at-creation inheritance: adopting a project stamps its
          // effective color and assigned users onto the draft task
          // (deselecting clears the inherited users).
          setNewTask({
            ...newTask,
            projectId: pid,
            ...(proj ? { color: getProjectColor(proj, parentGoal) } : {}),
            assignedUserSyncIds: proj?.assignedUserSyncIds || [],
          });
        }}
        className={fieldClass}
      >
        <option value="">{t('task.noProject')}</option>
        <option value={NEW_PROJECT_ID}>{t('task.newProjectOption')}</option>
        {(() => {
          const activeProjects = projects.filter(p => p.status !== 'archived' && p.status !== 'completed');
          const withGoal = activeProjects.filter(p => p.goalId);
          const standalone = activeProjects.filter(p => !p.goalId);
          const goalGroups = goals
            .filter(g => g.status !== 'archived' && withGoal.some(p => p.goalId === g.id))
            .map(g => ({ goal: g, projs: withGoal.filter(p => p.goalId === g.id) }));
          return (
            <>
              {goalGroups.map(({ goal, projs }) => (
                <optgroup key={goal.id} label={goal.title}>
                  {projs.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </optgroup>
              ))}
              {standalone.length > 0 && (
                <optgroup label={t('goals.standalone')}>
                  {standalone.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </optgroup>
              )}
            </>
          );
        })()}
      </select>
    </div>
  );
}
