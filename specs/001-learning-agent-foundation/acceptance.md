# Acceptance Criteria

本文件定义规格 001 的最终验收条件。状态列在实现阶段更新；Draft 阶段全部视为未验证。

## A. 安装与组合

| ID | 必须结果 | 证据 |
|---|---|---|
| A-001 | 在支持的 DSH 版本上通过标准外部 bundle 流程安装 | 干净环境安装日志 |
| A-002 | dump-config 中出现全部预期教学插件 | 配置快照 |
| A-003 | 启动教学 Agent 不需要修改 DSH checkout | clean-tree 证明和启动记录 |
| A-004 | 卸载 bundle 后其他 DSH profile 正常运行 | 卸载 e2e |
| A-005 | 插件 dispose 后 prompt、tools 和活动资源全部撤销 | lifecycle 集成测试 |

## B. 教学闭环

| ID | 必须结果 | 证据 |
|---|---|---|
| B-001 | 新 Session 说明教学方式和权限范围 | keyless snapshot |
| B-002 | 诊断包含目标、概念证据和真实任务证据 | 诊断 snapshot 与事件记录 |
| B-003 | 计划遵守前置关系，且调整包含原因 | planner 单测和事件快照 |
| B-004 | 一节课完整经过目标、讲解、检查点、练习、评测和状态更新 | 纵向 e2e |
| B-005 | 实践完成至少依赖一条 machine evidence | completion-rule 测试 |
| B-006 | 检查失败能区分实现、配置、环境和安全类别 | evaluator 测试 |
| B-007 | 每个练习有三级提示，前两级不包含完整实现 | snapshot 与泄露断言 |
| B-008 | 学习报告区分阅读、练习完成和综合验证 | 报告 snapshot |

## C. 状态与恢复

| ID | 必须结果 | 证据 |
|---|---|---|
| C-001 | 恢复原 Session 或创建同 Enrollment 的新 Session 后，目标、计划、当前单元、尝试和证据一致 | replay 与跨 Session 集成测试 |
| C-002 | 同一 Enrollment 可跨 Session 延续；不同 Learner 或 Enrollment 的学习状态互不污染 | continuity 与 isolation 测试 |
| C-003 | 重复事件或重复恢复不会重复授予完成状态 | 幂等测试 |
| C-004 | 长期 LearnerState 可由 Learner Event Store 和课程版本重建；模型实际看到的状态快照存在于对应 Session Log | 重建 invariant 与 Session snapshot 测试 |
| C-005 | 计划和 mastery 的每次变化都引用原因和证据 | 事件 schema 测试 |
| C-006 | 事件持久化前不报告领域成功；崩溃重试、序号断裂、损坏记录和缺失 Provider 均有确定结果 | 故障注入与恢复测试 |

## D. 课程质量

| ID | 必须结果 | 证据 |
|---|---|---|
| D-001 | MVP 覆盖规格定义的八项学习成果 | 课程覆盖报告 |
| D-002 | 每个单元具备目标、先修、来源、练习、提示、rubric 和完成条件 | 课程 schema gate |
| D-003 | 重复 ID、缺失先修和循环依赖在加载时失败 | 负向单测 |
| D-004 | 所有 DSH 来源声明适用版本并可解析 | source-anchor gate |
| D-005 | 至少三个课程单元可以连续完成 | journey e2e |
| D-006 | 至少包含 Tool、Provider 和 Bundle 综合实践 | 练习目录与 e2e |

## E. 安全

| ID | 必须结果 | 证据 |
|---|---|---|
| E-001 | 练习默认不能写入真实 DSH checkout | sandbox e2e |
| E-002 | reset 只能作用于已解析的当前 attempt 目录 | 路径和符号链接测试 |
| E-003 | 未授权命令不能绕过 DSH sandbox/approval | policy 集成测试 |
| E-004 | 课程和模型输入不能直接注入检查命令 | parser 与执行测试 |
| E-005 | 快照、日志和产物不包含测试凭据 | secret scan |

## F. 工程质量

| ID | 必须结果 | 证据 |
|---|---|---|
| F-AC-001 | TypeScript strict typecheck、lint、build 和发布检查通过 | CI 链接 |
| F-AC-002 | 业务源文件满足既定覆盖率门禁 | coverage 报告 |
| F-AC-003 | 关键用户旅程拥有真实组装的 keyless snapshots | snapshot 清单 |
| F-AC-004 | 支持矩阵中的 DSH 和 Node 版本通过 | matrix CI |
| F-AC-005 | README 能让新用户在约十分钟内启动第一个 Session | 新用户演练记录 |
| F-AC-006 | 文档描述、配置示例和实际命令一致 | docs gate 与人工复核 |

## G. 产品质量试验

以下项目是 0.1.0 发布所需的人工验收：

- 一名第一次接触 DSH 的开发者完成最小 Tool 练习。
- 一名熟悉 Agent 框架的开发者被诊断到不同起点。
- 学习者连续失败时，Agent 不虚构通过结果，也不在前两级提示中直接给答案。
- 环境故障被标记为 blocked，而不是误判为能力不足。
- 恢复原 Session 或开启同 Enrollment 的新 Session 后，学习者无需重新描述目标即可继续。

## 验收决策

规格可以标记 Accepted 的条件：

1. A 至 F 的全部条目通过。
2. G 中没有高严重度教学问题。
3. 没有未解决的高风险安全问题。
4. 已知限制、支持版本和升级方式已经发布。
5. 所有证据链接在发布 commit 上可复现。

## Phase 0 证据

Phase 0 不代表规格 001 整体验收完成。当前纵向切片提供以下可复现证据：

| 需求或验收项 | Phase 0 证据入口 |
|---|---|
| F-001、A-002、A-003、A-004 | `pnpm test:profile` 在隔离 profile 中安装、dump、移除，并保持上游 checkout 不变 |
| F-002、Q-001、A-005 | `pnpm test:unit` 验证教师 section 内容及 plugin fiber dispose 后撤销 |
| Q-005、F-AC-004 | `pnpm compat` 验证精确 DSH 版本、commit、Node 范围和 peer 声明 |
| Q-006、F-AC-003 | `pnpm test:snapshot` 通过真实 Loader 组装 keyless 教师 prompt |
| F-AC-001、F-AC-006 | `pnpm check` 汇总 lint、strict typecheck、unit、snapshot、build、docs、compatibility 和 profile checks |

## Phase 1 课程与长期学习状态证据

Phase 1 已完成课程、独立 learner-memory、纯投影、跨 Session 连续性和持久故障诊断。C-004 中“模型实际看到的快照进入 Session Log”的后半项仍由 Phase 2 完成。

| 需求或验收项 | 当前证据入口 |
|---|---|
| F-003、D-002、D-003 | `pnpm test:unit` 验证首个完整单元的 schema、SemVer、图、completion 引用和负向加载 |
| F-012、D-004 | `pnpm test:unit` 验证安全路径、四类 stable anchor、缺失 anchor 和 symlink 逃逸；`pnpm test:snapshot` 固定真实上游解析结果 |
| F-010、C-003、C-005 | `pnpm test:unit` 验证 typed learning events、全部 reducer 分支、Evidence 引用、非法转换不落盘和 EventId/CommandId 幂等 |
| F-011、Q-002、C-001、C-002、C-006 | `pnpm test:unit` 验证 fsync 后成功、flush、真实子进程重启、同 Enrollment 跨 Session 延续、不同 scope 隔离和损坏诊断 |
| F-001、A-002、A-005 | `pnpm test:profile` 验证 curriculum/learner-memory/learner/teacher bundle 行安装与移除；Service lifecycle 单测验证 dispose/reload |
| Q-006、F-AC-003 | Phase 1 的 `pnpm test:snapshot` 通过真实 Loader 组装教师 prompt、课程读取结果和已提交 LearnerState；它本身不作为 Session 请求审计证据 |

## Phase 2 第一个教学闭环证据

Phase 2 已完成一个可运行的纵向切片。它不代表诊断、三级提示、完整课程和发布验收已经完成。

| 需求或验收项 | 当前证据入口 |
|---|---|
| F-002、F-006、P2-01、B-001 | `pnpm test:unit` 验证教师 Persona 和动态上下文生命周期；`pnpm test:snapshot` 固定真实 Agent 请求中的教师 prompt、工具和当前活动 |
| F-005、F-006、P2-02、B-003、B-004 | `pnpm test:unit` 验证确定性先修规划和完整活动状态机；`pnpm test:snapshot` 固定 explain、checkpoint、exercise、feedback 和完成顺序 |
| F-010、P2-03、C-003、C-006 | `pnpm test:unit` 通过真实 ToolRuntime 验证三个学习工具、durability-before-success、稳定 command id 和崩溃重试幂等 |
| F-007、P2-04、E-001、E-002、E-004 | `pnpm test:unit` 通过真实 sandboxed FS/Shell 创建和重置 fixture，拒绝越界 workspace，并只执行固定 runner 与安全相对 entry |
| F-008、P2-05、B-005 | `pnpm test:unit` 和 `pnpm test:snapshot` 验证 implementation 失败、结构化 details/artifacts、成功 machine evidence 和无证据不完成；四类失败的完整覆盖仍属于后续验收 |
| F-011、Q-006、P2-06、C-001、C-002、C-004、F-AC-003 | `pnpm test:snapshot` 通过真实 Loader、Agent Loop 和 JSONL Session persistence 验证首次进入、失败、成功、原 Session 恢复、同 Enrollment 新 Session 延续，以及模型 LearnerState 与 Session Log 快照逐字一致 |
| F-001、A-002、A-005 | `pnpm test:profile` 验证七个 Learn DSH bundle 行的安装、dump-config 和无残留移除 |
