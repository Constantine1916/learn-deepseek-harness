# Implementation Plan

## 执行原则

- 每个阶段交付一个可运行、可验证的纵向切片。
- 优先证明教学闭环，不先建设课程平台或 Web UI。
- 先定义事件、课程 schema 和验收证据，再实现模型文案。
- 每个任务引用需求 ID，并在同一变更中加入对应测试和文档。

## Phase 0 — 仓库与兼容性基线

目标：建立可持续开发的工程骨架。

任务：

- P0-01（完成）：建立 pnpm workspace、TypeScript strict 配置和包命名规范。关联 Q-001、Q-005。
- P0-02（完成）：锁定首个支持的 DSH 版本和依赖获取方式。关联 F-001、Q-005。
- P0-03（完成）：创建最小 bundle 和 headless example，证明外部安装。关联 F-001。
- P0-04（完成）：建立 lint、typecheck、unit、snapshot、build 和 docs 门禁。关联 Q-006。
- P0-05（完成）：建立版本兼容矩阵和升级检查入口。关联 F-012、Q-005。

出口：

- 不修改 DSH checkout 即可加载一个 Learn DSH prompt section。
- dump-config 能看到 bundle 行。
- 卸载后没有残留注册。

## Phase 1 — 课程与学习状态基础

目标：让教学内容和学习状态成为可验证领域数据。

任务：

- P1-01（完成）：实现课程类型、schema、加载和课程图验证。关联 F-003。
- P1-02（完成）：提交第一个 foundations 课程单元和来源锚点。关联 F-003、F-012。
- P1-03（完成）：定义 LearnerId、EnrollmentId、EventId 等 branded IDs、学习事件和纯投影。关联 F-010、F-011。
- P1-04（完成）：实现 learner-memory Service Definition、持久 envelope 和本地追加式 Provider。关联 F-010、F-011、Q-002。
- P1-05（完成）：实现 learner 查询 Service、领域事件追加、持久化确认和幂等接口。关联 F-010、F-011。
- P1-06（完成）：验证原 Session 恢复、同 Enrollment 跨 Session 延续、不同 Enrollment 隔离和损坏诊断。关联 F-011、Q-002。

架构约束：`learning/*` 写入独立 Learner Event Store，不注册为 DSH Session event。模型实际收到的 LearnerState 快照在 Phase 2 通过 DSH 请求上下文进入对应 Session Log。

出口：

- 无效课程在加载时失败。
- 固定事件前缀产生稳定 LearnerState。
- 恢复原 Session 或为同一 Enrollment 创建新 Session 后，当前单元和证据一致。

## Phase 2 — 第一个教学闭环

目标：完成讲解、检查点、练习、评测和反馈的纵向切片。

任务：

- P2-01（完成）：实现教师 Persona、当前活动上下文和 Session Log 学习状态快照。关联 F-002、F-006、F-011。
- P2-02（完成）：实现活动状态机和最小规划器。关联 F-005、F-006。
- P2-03（完成）：实现 learning_get_state、learning_start_unit 和 learning_complete_activity。关联 F-005、F-010。
- P2-04（完成）：实现单个隔离练习 fixture、工作区创建和重置。关联 F-007。
- P2-05（完成）：实现结构化检查结果和反馈输入。关联 F-008。
- P2-06（完成）：增加首次进入、失败、成功、原 Session 恢复和同 Enrollment 新 Session 延续快照。关联 F-011、Q-006。

出口：

- Agent 能教授一个概念、创建一个真实练习、运行检查、解释结果并更新状态。
- 练习通过至少依赖一条 machine evidence。

## Phase 3 — 诊断与自适应计划

目标：针对不同学习背景生成有证据的不同路径。

任务：

- P3-01（完成）：实现目标收集和诊断活动。关联 F-004。
- P3-02（完成）：从课程 objectives/rubric 动态构造诊断候选，不播放固定题单。关联 F-004。
- P3-03（完成）：实现先修过滤、误区优先和目标路径选择。关联 F-005。
- P3-04（完成）：实现计划展示、用户显式跳过、调整和原因记录；跳过不设诊断证据门禁并使用独立 skipped 状态。关联 F-005。
- P3-05（完成）：增加初学者和有经验开发者两条 keyless 场景。关联 Q-004、Q-006。

出口：

- 两种输入背景得到不同且可解释的推荐起点。
- 所有计划变化都有持久原因；跳过保持用户控制且不生成掌握结论。

## Phase 4 — 练习、提示与完整基础课程

目标：覆盖核心学习成果并形成连续课程。

任务：

- P4-01（完成）：完成 Plugin/Context/Effect、Capability Seam、Tool/Bundle 三组课程。关联 F-003。
- P4-02（完成）：提供最小 Tool 和最小 Provider 练习。关联 F-007、F-008。
- P4-03（完成）：实现三级提示和提示使用事件。关联 F-009。
- P4-04（完成）：实现失败类别和 blocked 重试。关联 F-008。
- P4-05（完成）：实现综合 bundle 练习和学习报告。关联 F-013。

出口：

- 新用户可以连续完成至少三个单元。
- 八项学习成果都有课程和验收证据。
- 前两级提示不泄露完整实现。

## Phase 5 — 发布准备

目标：形成可安装、可升级、可验证的 0.1.0。

任务：

- P5-01（阻塞）：发布 @learn-dsh/bundle 及其依赖包。关联 F-001。受支持的 DSH `0.1.0-rc.5` 尚无完整 npm 包集；真实 publish 需要先确认 DSH 发布或兼容矩阵迁移策略。
- P5-02（部分完成）：本地 release candidate 已验证八个 tarball 的干净 consumer 安装、公开入口导入、profile 安装、卸载和重新安装。关联 F-001。纯 registry 安装和从安装后 profile 启动交互教学 Runtime 仍待发布依赖与 preset。
- P5-03（部分完成）：本地兼容性、完整 keyless snapshots、tracked-file/tarball secret scan、发布内容检查和 macOS/Linux Node matrix workflow 已建立。关联 Q-003、Q-005、Q-006。首次远程 matrix 结果和 100% coverage closure 仍待完成。
- P5-04：执行可选真实模型教学评估和人工 rubric。关联 Q-006。
- P5-05（完成）：完成快速开始、课程作者指南、故障排查、发布检查和已知限制。
- P5-06（进行中）：已汇总 Phase 0–4 与 Phase 5 本地发布候选证据；远程 CI、coverage closure、人工 rubric 和 registry 发布证据待补。

出口：

- [acceptance.md](acceptance.md) 中全部 Must 项通过。
- 新用户能够按照 README 在十分钟内启动第一个教学 Session。

## Phase 6 — MVP 之后

- Web 学习节点和知识地图。
- 间隔复习与误区模型。
- 多课程和多语言。
- 远程课程 Provider。
- 课程作者验证工具。
- DSH 版本迁移课程。
- 团队学习进度后端。

这些功能需要独立规格，不纳入 001 的完成条件。
