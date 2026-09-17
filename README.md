# Jobo

**Plan with intention. Record what happened. Review and adjust.**

## Development has moved to `jobo-main`

> You are viewing the legacy **`main`** branch. The independently maintained Jobo source, current documentation and all integrated desktop/mobile Jobo work are on **[`jobo-main`](https://github.com/Lcub3d/dayGLANCE/tree/jobo-main)**. This legacy branch is not the base for new Jobo development.

**[Open Jobo](https://github.com/Lcub3d/dayGLANCE/tree/jobo-main)** · **[中文说明](https://github.com/Lcub3d/dayGLANCE/blob/jobo-main/README.zh-CN.md)** · [Maintenance & provenance](https://github.com/Lcub3d/dayGLANCE/blob/jobo-main/docs/jobo-maintenance.md) · [Acknowledgements](https://github.com/Lcub3d/dayGLANCE/blob/jobo-main/ACKNOWLEDGEMENTS.md)

Jobo is an independent fork of [dayGLANCE](https://github.com/krelltunez/dayGLANCE), maintained by [Lcub3d](https://github.com/Lcub3d). It connects planning, actual-time recording, comparison and follow-up while retaining the existing planner foundation. It is not an official dayGLANCE release or an upstream maintenance appointment.

The Jobo mainline includes the earlier Simplified Chinese and Todoist contributions, desktop Jobo PR #1673 and mobile Plan / Do PR #1675. The original two Jobo PRs and their source branches are retained; integrating their code into this fork does not close or merge them upstream.

### Clone the correct branch

```bash
git clone --branch jobo-main --single-branch https://github.com/Lcub3d/dayGLANCE.git jobo
```

Read the mainline README before running the preview. Jobo remains experimental and local-only; its separate JSON backup is required because native cloud sync and standard backup do not automatically include the journal. Application identifiers, storage keys and native release channels have not been mass-renamed.

### 中文说明

**后续开发已转到 [`jobo-main`](https://github.com/Lcub3d/dayGLANCE/tree/jobo-main)。** 当前 `main` 只保留旧代码和新主线入口，不再作为 Jobo 新功能开发基线。GitHub 默认分支设置可能仍指向此处，请进入上面的 Jobo 链接，或克隆时明确指定 `--branch jobo-main`。

Jobo 由 Lcub3d 独立维护，基于 dayGLANCE；原中文适配、Todoist 同步以及桌面和移动端 Jobo 提交均在新主线中保留。上游 #1673、#1675 不关闭，来源分支不删除。当前仍是开发预览，不是完成独立安装包、数据迁移和云同步验证的正式发行版。

### Credits and preserved history

Thank you to **krelltunez and all dayGLANCE contributors** for the original project, its architecture, integrations and tests, and for reviewing the Jobo prototypes. The original [MIT LICENSE](LICENSE) and upstream copyright notice remain unchanged.

This branch's earlier documents are preserved as [README.upstream.md](README.upstream.md), [CONTRIBUTING.upstream.md](CONTRIBUTING.upstream.md) and [CLAUDE.upstream.md](CLAUDE.upstream.md). They document inherited upstream work, not the current Jobo development policy. No application code or Git history in this legacy branch was removed by the documentation transition.
