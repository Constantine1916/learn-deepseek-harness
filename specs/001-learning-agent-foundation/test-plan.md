# Test Plan

## 1. 测试目标

测试必须证明三个不同层面：

1. 领域逻辑正确：课程、事件、计划、完成规则和评测稳定。
2. DSH 组合正确：插件生命周期、作用域、Learner Event Store、Session 请求快照、工具和 bundle 按公开接口工作。
3. 教学体验达标：Agent 不虚构完成证据、不提前泄露答案，并能完成真实教学闭环。

## 2. 测试层级

### 2.1 静态门禁

每个变更运行与表面匹配的检查：

- TypeScript strict typecheck。
- lint 和格式检查。
- package exports 与发布内容检查。
- 课程 schema 和来源锚点检查。
- 文档链接和规格引用检查。
- git diff --check。

### 2.2 单元测试

必须覆盖：

- 课程 ID、版本范围和 schema 校验。
- 前置缺失与循环依赖。
- 来源路径和 anchor 解析。
- 学习事件 reducer 的每个分支。
- 重放幂等和非法状态转换。
- LearnerId、EnrollmentId、EventId、单调 seq 和事件版本校验。
- learner-memory 追加、读取前缀、flush、重复命令去重和损坏诊断。
- 候选活动筛选与先修判断。
- completion rule。
- 提示级别和泄露保护。
- 检查结果分类。
- 练习目录归属和 reset 目标解析。

发布门禁：packages 下被单元测试执行的业务源码整体至少保持 84% statement、72% branch、90% function 和 90% line coverage。纯类型、元数据常量、生成代码或不可执行声明不强制进入运行时 coverage；关键状态转换、持久化、安全边界和用户旅程仍必须由针对性测试与真实组装 snapshot 覆盖，不能仅依赖总体百分比。

### 2.3 Plugin 集成测试

在真实 Cordis/DSH Context 上验证：

- 插件加载、注册、dispose 和重复注册错误。
- scoped prompt 与全局 prompt 的组合。
- scoped tool 可见性、lookup 和执行一致。
- 学习事件写入 Learner Event Store 并重放。
- 原 Session 恢复与同 Enrollment 新 Session 延续。
- 不同 Learner、Enrollment 和 profile 存储根隔离。
- 模型实际收到的 LearnerState 快照进入对应 DSH Session Log。
- bundle patch 加载出预期插件树。
- 缺失必需 Service 时尽早失败。
- Lab 使用 DSH FS、Shell、Sandbox 和 Approval，而不是绕过它们。

### 2.4 Keyless Snapshot

通过真实可运行 example 记录稳定用户旅程。快照至少包括：

- 首次进入和教师身份。
- 目标收集。
- 初始诊断。
- 计划生成。
- 单元开始与目标展示。
- 练习创建。
- 检查失败和分类反馈。
- 一级、二级和三级提示。
- 检查成功和单元完成。
- 原 Session 恢复和同 Enrollment 新 Session 延续。
- 学习报告。

快照重点固定事件、工具调用、课程 ID、状态变化和必须出现的反馈字段。自然语言允许通过受控 fixture 保持稳定，不使用宽泛 normalizer 隐藏真实回归。

### 2.5 端到端测试

在安装后的 DSH Runtime 上执行：

1. 创建干净 learn-dsh profile。
2. 安装本地或发布 bundle。
3. 启动 headless 教学 Agent。
4. 完成一个 Tool 插件练习。
5. 停止并恢复 Session。
6. 创建同 Enrollment 的新 Session 并验证学习状态连续。
7. 验证不同 Enrollment 不共享状态。
8. 验证学习状态、Session 请求快照和工作区。
9. 卸载 bundle。

CI 的主要正确性证据必须 keyless。需要 DEEPSEEK_API_KEY 的真实模型测试在无 key 时自跳过。

### 2.6 真实模型与人工教学评估

发布候选在受控数据集上评估：

- 初学者背景。
- 熟悉其他 Agent 框架的开发者。
- 已熟悉 DSH 的开发者。
- 连续答错、要求完整答案和偏离课程的场景。
- 环境错误与代码错误混合场景。

人工 rubric 检查：

- 解释是否准确且对应当前 DSH 版本。
- 是否先收集证据再改变掌握状态。
- 是否区分错误类别。
- 是否按层级给提示。
- 是否保留学习者思考空间。
- 推荐路径是否与证据一致。

## 3. 安全测试

- 课程 source 路径不能逃逸允许根目录。
- 练习工作区不能写入真实 DSH checkout。
- reset 不能接受未归属目录、根目录、HOME 或符号链接逃逸目标。
- 检查命令不能由未验证课程文本或模型字符串直接拼接。
- 未授权命令继续触发 DSH approval。
- 不可信课程字段不能注入 Cordis 配置或 shell 参数。
- 日志、快照和失败产物不能包含凭据。
- learner-memory 路径不能逃逸配置根，不能由 Session 内容触发自动安装插件或连接未配置后端。
- 不同 LearnerId、EnrollmentId 和 profile 的持久记录不能串线。
- dispose 必须停止活动进程并清理 attempt 资源。

## 4. 兼容性测试

每个发布分支维护支持矩阵：

| 维度 | 最低要求 |
|---|---|
| DSH | 声明范围的最低和最高版本 |
| Node.js | DSH 支持范围内的最低版本与最新稳定版本 |
| OS | macOS 和 Linux |
| Profile | headless 必测，Web 在实现后加入 |

上游 DSH 更新检查：

- package exports 是否仍存在。
- bundle/profile 安装是否成功。
- 课程 source anchors 是否解析。
- snapshots 是否保持语义。
- learner event envelope、Provider schema version 和迁移入口是否兼容。
- 练习模板和检查是否仍通过。

## 5. 故障注入

必须覆盖：

- 课程文件损坏。
- 来源 anchor 消失。
- 检查进程超时或被取消。
- 进程分别在 learner event 持久化前、持久化后和工具成功返回前终止。
- Session 请求快照写入前终止，但 Learner Event Store 已提交。
- 重复提交同一个 EvidenceId。
- learner-memory 记录损坏、序号断裂、未知必需事件版本或 Provider 缺失。
- bundle dispose 发生在活动课程中。
- DSH Provider 缺失或配置无效。

系统必须给出明确诊断，不得静默跳过或错误授予完成状态。

## 6. 需求追踪

测试名称或元数据必须引用 F/Q ID。例如：

~~~text
F-003 rejects a cyclic curriculum graph
F-011 continues one enrollment across sessions without cross-enrollment leakage
Q-003 rejects reset outside the resolved attempt directory
~~~

验收证据汇总到 [acceptance.md](acceptance.md)，不在多个文档复制测试结果。

## 7. Phase 0 门禁

Phase 0 的可复现入口：

- `pnpm lint`：检查 packages、examples、scripts 和测试配置。
- `pnpm typecheck`：strict 检查可发布源码、example、测试和 Vitest 配置。
- `pnpm test:unit`：验证 bundle patch 组合和教师插件 dispose。
- `pnpm test:snapshot`：通过真实 DSH app boot 与 Cordis Loader 固定教师 prompt。
- `pnpm build`：构建全部公开包和 headless example。
- `pnpm docs:check`：检查仓库 Markdown 相对链接。
- `pnpm compat`：检查 DSH 版本、checkout commit、Node 范围和 peer 声明。
- `pnpm test:profile`：在临时 `DSH_HOME` 中安装 bundle、检查 `dump-config`，再移除并检查无残留配置行。

## 8. Phase 1 课程与长期学习状态证据

- `pnpm test:unit`：验证课程 schema、SemVer、重复 ID、缺失先修、循环、completion 引用、路径安全、四类来源 anchor、symlink 逃逸和 curriculum Service dispose/reload。
- `pnpm test:unit`：验证全部学习事件分支、非法转换不落盘、EventId/CommandId 幂等、flush、真实子进程重启、跨 Session 延续、Learner/Enrollment 隔离，以及 JSON、torn record、序号、版本和身份损坏诊断。
- `pnpm test:snapshot`：通过真实 DSH app boot 与 Cordis Loader 固定课程来源、四个已提交 learner event 和重放后的 LearnerState。
- `pnpm test:profile`：安装后的 profile 同时出现 curriculum、learner-memory、learner 与 teacher 行，移除 bundle 后均无残留。

模型实际收到的 LearnerState 快照进入 DSH Session Log 属于 Phase 2；Phase 1 不把 headless 状态输出误记为 Session 请求审计证据。

## 9. Phase 2 第一个教学闭环证据

- `pnpm test:unit`：验证 `explain → checkpoint → exercise → feedback` 转换、确定性先修规划、非法跳转拒绝、稳定命令重试、失败后同 attempt 重试、machine evidence 门禁和单元完成。
- `pnpm test:unit`：通过真实 DSH ToolRuntime 执行 `learning_get_state`、`learning_start_unit` 和 `learning_complete_activity`，并验证工具只返回已提交状态。
- `pnpm test:unit`：通过 DSH sandbox、FS、Shell 和 policy 创建、检查、重置真实 fixture；验证 workspace 归属、marker 身份、失败分类和通过产物。
- `pnpm test:snapshot`：通过真实 Loader、Agent Loop、脚本 LLM adapter 和 JSONL Session persistence 固定首次进入、失败检查、成功检查、原 Session 恢复和同 Enrollment 新 Session 延续。每个模型请求中的 `learn-dsh:learner-state` 文本必须逐字存在于对应 Session Log。
- `pnpm test:profile`：安装后的 profile 出现 curriculum、learner-memory、learner、lab、teaching、teacher 和 tool-learning 行，移除 bundle 后无残留。
- `pnpm check`：汇总 lint、strict typecheck、unit、snapshot、build、docs、compatibility 和 profile 门禁。

## 10. Phase 3 诊断与自适应计划证据

- `pnpm test:unit`：验证诊断候选由目标路径的 objectives、required rubric 和 evidenceKinds 动态生成，不依赖固定题目列表。
- `pnpm test:unit`：验证 `meets | gap | uncertain`、observed source 引用、machine evidence 引用和缺失 required rubric 的拒绝结果。
- `pnpm test:unit`：验证 `gap`、`uncertain` 或没有诊断掌握证据都不阻止学习者显式跳过，且系统不会自动跳过。
- `pnpm test:unit`：验证显式跳过写入不要求 EvidenceId 的 `learning/unit-skipped`，`skipped` 满足导航先修但与 completed/mastery 保持可区分。
- `pnpm test:unit`：验证误区仍影响推荐和报告、计划遵守先修关系，以及每次计划变化保存原因和可用 evidence 引用。
- `pnpm test:snapshot`：通过真实 Loader、Agent Loop 和 Session persistence 固定初学者与有经验开发者的不同诊断结果、计划、用户显式跳过和推荐起点。

## 11. Phase 4 完整基础课程证据

- `pnpm test:unit`：验证四个连续单元覆盖八项 learning outcomes，线性先修关系可达，且包含最小 Provider、最小 Tool 和综合 Bundle 实践。
- `pnpm test:unit`：验证每个练习三级提示按顺序发放，提示事件先持久化再返回，重复命令幂等，前两级拒绝 fenced code、完整实现声明和超出预算的内容。
- `pnpm test:unit`：通过真实 Lab Provider 固定 implementation failed，以及 configuration、environment、safety blocked 分类；blocked 恢复后同 attempt 可以重试且不降低 mastery。
- `pnpm test:unit`：验证全部单元真实完成后幂等追加 course-completed；存在 skipped 单元时不追加，并生成区分 started/read、user-skipped、exercise-completed 和 comprehensive-validated 的学习报告。
- `pnpm test:snapshot`：通过真实 Agent Loop 固定三级提示、blocked 重试、四个连续单元的关键状态以及最终学习报告。

## 12. Phase 5 发布候选门禁

- `pnpm test:coverage`：生成业务源码 text、JSON summary 和 LCOV 报告，并以 84% statements、72% branches、90% functions、90% lines 作为强制防回退门禁。阈值与 2.2 节一致，通过时可作为 F-AC-002 证据。
- `pnpm security:check`：扫描 Git 跟踪文本和环境文件名，拒绝 private key、OpenAI/DeepSeek 风格 key、GitHub token 和 AWS access key 等高置信度凭据模式。
- `pnpm eval:teaching:keyless`：对真实组装 snapshot 执行来源准确性、证据边界、自适应路径、提示顺序、blocked 重试、Session Log 审计和报告语义 rubric；它不替代真人参与者验收。
- `pnpm test:profile`：在临时 `DSH_HOME` 中执行 preset install/check/remove、web profile add、dump-config、app-owned `--help`、remove、reinstall、第二次 remove，并证明独立 headless profile 不变。
- `pnpm release:check`：打包八个公开 package，检查发布元数据、runtime dependency protocol、tarball 内容、export/bin 目标和凭据模式；在临时 consumer 中从 npm registry 安装精确 `@deepseek-ai/dsh@0.1.2-rc.1`，只从 tarball 安装 Learn DSH，拒绝 DSH `link:`、workspace protocol 和混合版本，导入公开入口，并从安装后 bundle 路径复用 preset/profile 重装与 keyless 教学门禁。
- `.github/workflows/ci.yml`：在 Linux Node 22.19、Linux Node 24 和 macOS Node 22.19 上安装 registry DSH `0.1.2-rc.1` 并运行 `pnpm check`；锁定来源 checkout 只供课程 source-anchor gate 使用。

DSH `0.1.2-rc.1` 的发布包闭包必须成为运行时唯一来源；来源 checkout 不得通过 `link:`、workspace protocol 或模块回退进入临时 consumer。真实模型和真人参与者 rubric 不由 deterministic CI 替代。
