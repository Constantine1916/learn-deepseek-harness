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
| C-001 | 恢复后目标、计划、当前单元、尝试和证据一致 | replay 集成测试 |
| C-002 | 两个 Session 的学习状态互不污染 | isolation 测试 |
| C-003 | 重复事件或重复恢复不会重复授予完成状态 | 幂等测试 |
| C-004 | 模型可见学习状态可由 Session Log 和课程版本重建 | 重建 invariant 测试 |
| C-005 | 计划和 mastery 的每次变化都引用原因和证据 | 事件 schema 测试 |

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
- 恢复 Session 后，学习者无需重新描述目标即可继续。

## 验收决策

规格可以标记 Accepted 的条件：

1. A 至 F 的全部条目通过。
2. G 中没有高严重度教学问题。
3. 没有未解决的高风险安全问题。
4. 已知限制、支持版本和升级方式已经发布。
5. 所有证据链接在发布 commit 上可复现。
