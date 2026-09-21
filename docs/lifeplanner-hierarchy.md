# Life Planner hierarchy bridge

本模块把已有的 Life Planner 文档和原生 Goals & Projects 数据投影到同一棵可读层级中。它只读 `wishes[].visions[].steps[]`，不把任务复制到 Life Planner，也不把缺失的 native row 当成已存在。

## 数据边界

Life Planner 存在 `day-planner-lifeplanner-v1`，原生数据分别存在：

- `day-planner-goals`
- `day-planner-projects`
- `day-planner-tasks`
- `day-planner-unscheduled`
- `day-planner-recurring-tasks`

原生项目仍以 `project.goalId` 连接目标，任务仍以 `task.projectId` 连接项目。`useDataPersistence` 和 GLANCEvault `dbAdapter` 会保留这些对象中的额外字段，因此 ancestry 字段不需要另建存储表。

## 身份与出处

每个阶段的出处由三元组确定：

```js
{
  source_app: 'app.dayglance.lifeplanner',
  lifeplanner: { wishId, visionId, stepId }
}
```

目标 ID 使用 `life-goal-${stepId}`；`stepId` 在经过 `validateDocument` 的 Life Planner 文档中唯一。超长手工 ID 使用稳定短后缀，最终不超过原生 ID 的 100 字符限制。项目继续使用已有的 `life-${stepId}`，所以当前 `step.projectId` 不会被重建或改名。

新建目标的示例（标题和日期与 Life Planner 的逐年目标使用同一套 `measureText` / `milestoneDate` 计算）：

```js
{
  id: 'life-goal-step-1',
  title: 'Read 40 books',
  targetDate: '2027-01-01',
  status: 'active',
  source_app: 'app.dayglance.lifeplanner',
  lifeplanner: { wishId: 'wish-1', visionId: 'vision-1', stepId: 'step-1' },
  createdAt,
  updatedAt
}
```

项目的 `goalId` 指向 native goal；任务只保留已有 `projectId`。旧项目没有 `goalId` 时可以补上，但已有非空 `goalId` 永远不被抢占。

## 纯函数接口

`src/lifeplanner/hierarchy.js` 导出：

- `provenanceForStep(wish, vision, step)`：生成完整出处。
- `stableGoalId({ wishId, visionId, stepId })`、`stableProjectId(stepId)`：生成可重试的 ID。
- `buildHierarchy(input)`：生成只读投影。每个阶段是一个 `goals[]` 语义目标节点；`nativeGoalId` 为空表示 native goal 尚未落地。项目位于该节点的 `projects[]` 中，任务按 `tasks`、`unscheduledTasks`、`recurringTasks` 保留原生列表边界。无法证明归属的对象进入 `orphans`，冲突进入 `conflicts`。
- `planStepLinkMigration(input)`：生成迁移计划和完整恢复 snapshot。后台计划只处理已有明确 `step.projectId` 或完整 Life Planner provenance 的项目；没有项目的阶段不自动创建 native goal。对于已有项目但缺少 `step.goalId` 的阶段，计划会生成带有 `projectId`、`goalId`、`beforeProjectId` 和 `beforeGoalId` 的 `link-step-project` 操作；执行器会在两个字段都已匹配时跳过它。已有不一致的 `step.goalId` 会记录 `step-goal-conflict` 并保留原值。
- `ensureStepGoal(args)`、`ensureStepProject(args)`：供用户明确点击创建/重试时使用。两者都支持稳定 ID 和幂等重试；`allowDeleted: true` 是显式用户重试被 tombstone 阻止的对象时才可传入的选项。
- `executeStepLinkMigration(plan, options)`：先写本地 snapshot，再按计划执行。snapshot 已存在时不会覆盖首次基准；写入失败返回 `{ status: 'error', reason: 'backup' }`，不会调用任何 native mutator。

典型投影形状：

```js
{
  wishes: [{
    id, title,
    visions: [{
      id, title,
      goals: [{
        id: 'life-goal-step-1',
        stepId,
        nativeGoalId: 'life-goal-step-1' | null,
        projects: [{
          id,
          nativeGoalId,
          tasks: { tasks: [], unscheduledTasks: [], recurringTasks: [] }
        }]
      }]
    }]
  }],
  conflicts: [],
  orphans: { goals: [], projects: [], tasks: [], unscheduledTasks: [], recurringTasks: [] }
}
```

## React bridge

`src/hooks/useLifePlannerHierarchy.js` 只在显式调用时执行写入，不在 render 或 mount 中自动迁移：

```js
const hierarchy = useLifePlannerHierarchy({
  document: lifePlannerDocument,
  goals, projects, tasks, unscheduledTasks, recurringTasks,
  dataLoaded,
  multiUserEnabled,
  readOnly,
  addGoal, updateGoal, addProject, updateProject,
  commitLifePlanner: operation => commitStepProjectLink(operation),
});
```

返回 `hierarchy`、`migrationPlan`、`ensureStepGoal`、`ensureStepProject`、`executeMigration`、`readSnapshot` 和 `guardReason`。`executeMigration()` 在数据未加载、多用户或只读状态下只返回 `status: 'skipped'`，不会创建目标；`commitLifePlanner` 由拥有 planner store 的调用方实现并应按三元组幂等提交 `step.projectId` 和 `step.goalId`。

迁移调用方可以在编辑器、草稿和 pending 写入都为空时显式触发一次：

```js
const { migrationPlan, executeMigration, ready } = useLifePlannerHierarchy({
  document, goals, projects, tasks, unscheduledTasks, recurringTasks,
  dataLoaded, multiUserEnabled, readOnly,
  addGoal, updateGoal, addProject, updateProject,
  commitLifePlanner: operation => store.commit(current => commitStepLink(current, operation)),
});

useEffect(() => {
  if (ready && migrationPlan.operations.length > 0 && !editing && !pending) {
    void executeMigration({ plan: migrationPlan });
  }
}, [ready, migrationPlan, editing, pending, executeMigration]);
```

`commitStepLink` 应同时检查并写入两个字段，接受的操作形状如下：

```js
{
  type: 'link-step-project',
  wishId, visionId, stepId,
  projectId: 'life-step-1', goalId: 'life-goal-step-1',
  beforeProjectId: null, beforeGoalId: null,
}
```

## 兼容与恢复规则

- `step.projectId` 指向的现有项目优先沿用，项目 ID、任务 ID 和任务所在列表都不变。
- `project.goalId` 非空时保持原值；如果它与阶段目标不一致，记录 `project-goal-conflict`，不更新项目，也不为该项目强行创建替代关系。
- `day-planner-deleted-goal-ids` 和 `day-planner-deleted-project-ids` 是 tombstone。后台迁移不会复活其中的 ID；明确的新项目/目标重试才可传 `allowDeleted: true`。
- Hook 默认读取这两个 tombstone key；`dataLoaded === false`、`multiUserEnabled === true` 或 `readOnly === true` 时，`ensureStepGoal`、`ensureStepProject` 和 `executeMigration` 都只返回 `status: 'skipped'`，不会触发 native 或 Life Planner 写入。`executeMigration` 还要求先成功写入 snapshot；写入失败返回 `status: 'error', reason: 'backup'` 并停止。
- orphan 和 conflict 都保留在投影中，供未来思维导图入口显示或提示；本轮不渲染思维导图页面。
- snapshot 键为 `day-planner-lifeplanner-hierarchy-snapshot-v1`。首次成功写入的基准保持不变，直到用户或恢复流程明确清理它。
