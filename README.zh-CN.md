# Jobo

**把计划与实际放在一起，让记录成为下一次调整的依据。**

[English](README.md) · [进入 Jobo 开发主线](https://github.com/Lcub3d/dayGLANCE/tree/jobo-main) · [维护规则与代码来源](docs/jobo-maintenance.md) · [致谢](ACKNOWLEDGEMENTS.md)

> **Jobo 是基于 [dayGLANCE](https://github.com/krelltunez/dayGLANCE)、由 [Lcub3d](https://github.com/Lcub3d) 独立维护的衍生版本，不是 dayGLANCE 官方发行版。** 后续 Jobo 开发统一进入 **`jobo-main`**。暂时保留现有仓库地址，以保留贡献历史和上游 PR 关系。
>
> **当前状态：开发预览。** Plan / Do 日志仍为默认关闭、需要主动启用的本地功能。请先使用单独的 Jobo JSON 导出备份；不要认为原生云同步和普通备份已经覆盖这份日志。

## 不仅安排要做什么，也记录实际发生了什么

Jobo 在原有日程、任务和笔记基础上，连接一个小而完整的 PDCA 循环：

| 环节 | 当前已有内容 |
| --- | --- |
| **Plan／计划** | 使用原有任务和排程，保留首次观察到的有效定时计划基线。尚未覆盖全部排程入口，因此不是完整计划修订历史。 |
| **Do／执行** | 记录和调整实际时间区间，支持同一任务多次执行，也支持不关联任务的临时活动。 |
| **Check／检查** | 对比计划和执行，分别表达时间偏差与单次执行进展，用原有笔记补充背景。 |
| **Act／调整** | 通过 Carry Forward 选择需要继续处理的工作，复制为新的收件箱任务，保留原来的计划与执行记录。 |

**桌面端**提供 Plan / Do / Notes 日视图，以及结合过去执行与后续计划的周视图。**移动端**提供共享时间轴的 Plan / Do 布局、可折叠任务列表和原生日笔记，同时保留原有网格入口。

**记录一次 Do，不等于完成原任务，也不会向 Todoist 发送完成命令。** 执行进展属于某一次记录，不是整个任务的自动完成率。没有记录，也不能被当成对现实行为的确定判断。

原有 dayGLANCE 的任务组织、日历视图、笔记、主题及可选集成继续作为基础。基本 Jobo 循环不强制依赖 Todoist 或 Obsidian。

## 已纳入的原有贡献

| 原 dayGLANCE PR | 内容 | 纳入方式 |
| --- | --- | --- |
| [#1555](https://github.com/krelltunez/dayGLANCE/pull/1555) | 简体中文适配 | 随上游提交历史继承 |
| [#1566](https://github.com/krelltunez/dayGLANCE/pull/1566) | 剩余 GLANCE 文案与“领域”术语修正 | 随上游提交历史继承 |
| [#1604](https://github.com/krelltunez/dayGLANCE/pull/1604) | Todoist 选择性同步 | 随上游提交历史及其后续修正继承 |
| [#1673](https://github.com/krelltunez/dayGLANCE/pull/1673) | 桌面 Jobo 日志与 PDCA 原型 | 已包含在移动端分支的祖先提交中 |
| [#1675](https://github.com/krelltunez/dayGLANCE/pull/1675) | 移动端 Plan / Do 日志 | 作为 `jobo-main` 的起始源码版本 |

将代码纳入本分支，**不等于在上游合并或关闭 PR**。两个 Jobo PR 及其来源分支继续保留；新的产品功能不再不断叠加到这两个待评审分支。具体提交 SHA 见[维护与来源说明](docs/jobo-maintenance.md)。

## 从源码运行

使用 Node.js 22 和 npm。建议使用**独立浏览器配置与独立访问地址**，不要直接覆盖保存重要数据的 dayGLANCE 环境。

```bash
git clone --branch jobo-main --single-branch https://github.com/Lcub3d/dayGLANCE.git jobo
cd jobo
npm ci
npm run dev -- --host 127.0.0.1 --port 5184 --strictPort
```

打开 `http://127.0.0.1:5184`。不同访问源拥有独立浏览器存储；这不是自动迁移已有数据。

在设置中启用实验性 Jobo。移动端进入“设置／App”启用，再通过 Timeline／Grid 中的 Plan / Do 切换入口使用。该开关仍默认关闭，多用户和托盘模式的原有限制保持不变。

开发校验命令：

```bash
npm run lint
npm test
npm run build
npm run build:android
```

最后一项只构建 Android WebView 资源，**不是 APK 打包或签名**。[Jobo CI](https://github.com/Lcub3d/dayGLANCE/actions/workflows/jobo-ci.yml?query=branch%3Ajobo-main) 还会运行已有浏览器交互回归，并保存精确源码、日志和实测截图。以具体运行记录为准，不能仅凭截图存在就认定测试通过。

## 使用边界

**数据安全尚需继续完善。** 当前 ledger 使用 `localStorage`，它是用户原始记录而非缓存。IndexedDB、并发写入、备份恢复和跨设备生命周期还没有全部解决，不应为了节省空间清理历史记录。

**必须区分普通备份与 Jobo 备份。** 原生云同步、普通导出以及所有重置／恢复入口尚未完整覆盖 Jobo。请使用单独的 Jobo JSON 导出；恢复可能替换本地集合，而且尚未实现所有存储之间的事务性恢复。

**本次建主线不等于新增全部规划功能。** 自动活动记录、番茄钟自动归属、完整统计分析、AI 复盘和更长周期的目标体系，并没有因此自动实现。

**本次也不是完整的软件改名和正式发行。** 为避免破坏现有数据与集成，没有批量修改应用 ID、存储键、内部 `dayglance` 标识和继承的版本号。源码中的 `5.2.0` 和上游商店下载入口不能当成 Jobo 的正式发行。独立安装包、更新渠道和数据迁移需要另行验证。

[桌面设计记录](docs/jobo-design.md) 保留了原 PR 的精确语义；其中较早的“不含移动端”描述属于当时范围，在本分支应结合[移动端补充说明](docs/jobo-mobile-review.md) 阅读。周视图规则、循环任务与外部身份、时区变化、无障碍及真实手机表现仍需持续校验。

## 独立维护，继续合作

Jobo 的功能方向、实现、问题处理和版本范围由 **Lcub3d** 负责，不以 dayGLANCE 的合并时间为前提。适合上游的独立改进仍可单独贡献，是否采用由上游自行决定。

新开发从 **`jobo-main`** 出发。旧 `main` 与两个上游 PR 来源分支不再承担新功能主线。协作规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，AI 开发约束见 [AGENTS.md](AGENTS.md)。原上游 README、贡献说明和 Claude 说明分别保存在 `README.upstream.md`、`CONTRIBUTING.upstream.md`、`CLAUDE.upstream.md`，作为历史参考而非本版本的发布承诺。

## 致谢与许可

感谢 **krelltunez 和 dayGLANCE 的所有贡献者**提供原始项目及其日程、集成、本地化与测试基础，也感谢围绕 Jobo 原型提出的评审和建议。

本分支保留原始 [MIT LICENSE](LICENSE) 和上游版权声明，不重写或抹去原贡献记录。关于上游基础、Jobo 贡献与 AI 辅助实现的说明，见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。
