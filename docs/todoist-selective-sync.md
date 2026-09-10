# Todoist 选择性同步（第一版）

## 基线与范围

分支：`feature/todoist-selective-sync`，位于 `Lcub3d/dayGLANCE`。
基于 2026-09-10 检查到的上游主线 `8c2cb867cde9f03ce4454248a4dc69ce54e9c8f7`（v5.0.0 发布后的主线），不修改原 main 或翻译分支。

这是“选择性导入 + 受限完成回写”的测试版，不是所有字段完全双向同步。Todoist 管任务内容，dayGLANCE 管执行时间。设置功能优先，桌面设置与手机设置都提供 Todoist 入口。

## 已实现的行为

| 项目 | 第一版行为 |
|---|---|
| 连接 | 用户在设置中填写个人 API Token；先验证账号并只读加载预览 |
| 筛选 | P1–P4、项目多选、标签多选；条件组之间支持 AND / OR |
| 细分条件 | 可包含子项目；标签可选包含任一或全部 |
| 默认值 | 同步关闭、完成回写关闭，预选 P1/P2；全部条件留空则导入零条 |
| 预览 | 显示匹配数量、前 8 条任务及 Todoist 原始任务日期；不修改任务 |
| 导入 | 匹配的未完成任务进入 dayGLANCE 收件箱；使用账号与远端任务 ID 去重 |
| 内容更新 | 拉取标题、备注、优先级、明确的 deadline、完成状态；项目/标签/due 保留在来源元数据 |
| 本地排程 | 不覆盖已安排日期、开始时间、时长、颜色；拖动时间块不回写 Todoist 日期 |
| 内容冲突 | 三方比较；两端都改动的字段先保留本地，设置中可采用远端值或保留本地值 |
| 完成回写 | 单独开启后，只回写普通任务的完成操作，不回写取消完成 |
| 回写保护 | 循环任务、有未完成子任务的父任务、分配给他人的任务不自动完成；每批最多 25 条 |
| 重试 | 操作 UUID 先落盘；逐项检查 sync_status；失败保留同一 UUID；限流遵守重试等待 |
| 自动同步 | 应用前台每 1 / 5 / 15 分钟，支持仅手动、回到前台及恢复联网触发 |
| 删除/移出筛选 | 不传播删除；已导入任务保留，移出范围后停止更新；尊重本地回收站和删除标记 |
| 断开 | 清除会话 Token、停止同步与回写，保留任务和操作记录 |

## 推荐首次设置

先使用少量测试任务，不直接用重要生产任务测试完成回写。

1. 打开本分支构建的 dayGLANCE → 设置 → Todoist 同步。
2. 在 Todoist 网页端的“设置 → 集成 → 开发者”复制个人 API Token，粘贴到 dayGLANCE。不要发给聊天助手或提交仓库。
3. 点击“连接并加载预览”。此操作不导入、不修改任务。
4. 例如选择 P1/P2、项目“工作”、标签“dayglance”，条件为 AND，即只导入工作项目中同时带该标签的 P1/P2 任务。
5. 检查匹配数后开启选择性同步；也可先选择“仅手动”再点击“立即同步”。
6. 确认导入与排程正常后，仅在一个设备考虑开启完成回写。开启时，此前已在本地完成但尚未回写的关联任务也可能被发送。

## 明确未做的内容

- 不自动把 dayGLANCE 原生任务导出为 Todoist 新任务。
- 不回写标题、备注、优先级、标签、项目、任务日期、deadline 或撤销完成。
- 不转换 Todoist 循环规则，不生成每次循环的本地完成历史。循环任务在本版是来源记录；请在 Todoist 完成。
- 子任务按独立来源任务筛选，不重建 dayGLANCE 内嵌子任务树。
- 没有 Webhook、关闭应用后的后台服务或实时推送。
- 没有注册 OAuth 应用或在代码中保存 client_secret；本版为个人 Token 接入。
- 不支持多用户模式下进行 Todoist 同步。已导入任务仍是普通 dayGLANCE 数据，之后启用共享或云同步时需自行确认共享范围。
- 完成回写仅建议一个设备开启；同源窗口有 Web Locks 防并发，但不同设备之间没有分布式写锁。
- 没有部署到上游官方网站，也没有替换已安装的官方客户端；必须运行本分支版本。

## 数据与安全

使用官方 `https://api.todoist.com/api/v1/sync`，不使用旧 REST v2 / Sync v9 地址。Token 只放 Authorization 请求头，请求不经过第三方代理。项目与标签筛选在本机执行，因此 API 会读取并缓存账号任务数据，但只有匹配任务导入 dayGLANCE。

Token 与账号标识使用 sessionStorage 的 `dg-todoist-*` 键。配置、同步游标、来源缓存、待确认队列使用 localStorage 的同名前缀。该前缀不属于 dayGLANCE 的 `day-planner-*` 设备设置备份集合。Token 不随配置/备份传播；这不是防同源脚本的加密存储。导入后的任务本身可以进入 dayGLANCE 的常规备份与云同步。断开不会抹除来源缓存或操作记录；重置应用会清除本地数据。

重新连接时先确认账号，再恢复该账号旧游标，避免漏掉应用关闭期间收到的完成变更。若来源记录缺失，不猜测其已完成或已删除。修改筛选或断开会取消尚未应用的请求结果，但不能撤销 Todoist 已经接受的完成请求。

Todoist 的显示 P1 对应 Sync API 的 priority=4，对应 dayGLANCE priority=3。`due` 是任务日期，`deadline` 是截止日期；本版不把二者混为一谈。

## 模块与维护

- `src/todoist/core.js`：纯筛选、映射、三方合并、写入队列策略。
- `src/todoist/client.js`：固定端点、超时、授权、限流、缓存读写、只读重连。
- `src/hooks/useTodoistSync.js`：生命周期、React 状态、前台调度、并发锁、持久化。
- `src/components/TodoistSettings.jsx`：共用设置界面。
- `src/todoist/strings.js`：独立 `todoist` i18next 命名空间；本测试版提供中英文，其他语言回退英文，不改动既有翻译。
- `src/todoist/core.test.js`、`settings.test.jsx`：策略、网络模拟、重连、界面渲染和命名空间测试。

运行验证：`npm ci`、`npm run lint`、`npm test`、`npm run build`。GitHub Actions 的 `dayglance-web` 是 Web 构建产物，不是 APK/EXE；`dayglance-source` 内的 TESTED_COMMIT.txt 标记被检查的源码提交。

真实账号端到端测试、Android/iOS/Electron 实机网络与凭据存储测试，不能由模拟 API 或静态构建替代。正式使用前应验证只读导入、一次普通任务完成、断网重试、重新连接、移出筛选与两端内容冲突。

## 后续规划（未实现）

第二阶段优先补循环任务实例身份、可靠的取消完成语义、显式选择字段的双向编辑与排程日期映射；第三阶段再考虑 OAuth 与系统安全存储、跨设备写入协调和后台同步。不能简单把循环任务当前 due 改写为 dayGLANCE 本地排程日期，否则会改变 Todoist 的重复规则语义。

参考：Todoist 官方 API 文档 https://developer.todoist.com/api/v1/；Token 获取说明 https://www.todoist.com/help/todoist/integrations/find-your-api-token-Jpzx9IIlB 。
