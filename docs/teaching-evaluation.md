# Teaching evaluation

发布验收分成三个层次，不能互相冒充：

1. `pnpm eval:teaching:keyless` 对真实 Loader、Agent Loop 和 Session persistence snapshot 执行结构化 rubric。
2. 可选真实模型评估验证自然语言解释、追问和反馈在非脚本模型下仍然可靠。
3. 真人参与者试用验证课程是否真的容易理解和完成。

## Keyless rubric

自动门禁检查：

- 教师先说明来源、权限与持久证据边界。
- 讲解绑定受支持的 DSH version/commit。
- checkpoint 要求学习者用自己的话产生输出。
- implementation failure 不授予完成。
- environment blocked 不被解释为能力失败，并在同一 attempt 重试。
- 提示按 1、2、3 级顺序持久化。
- 初学者与有经验开发者得到不同诊断路径，显式跳过不变成 mastery。
- 每个模型请求的 LearnerState 都有精确 Session Log 快照。
- 最终报告区分 skipped、exercise completion 和 verified capability。

该门禁是确定性 CI 证据，不是人工教学体验结论。

## Real-model protocol

真实模型评估使用独立测试 Enrollment，不复用个人学习记录。场景至少包含：

- 初学者请求建立整体模型。
- 熟悉其他 Agent 框架的开发者要求跳过基础单元。
- 连续答错并请求直接给完整答案。
- 环境错误与代码错误混合。
- 原 Session 恢复以及同 Enrollment 新 Session 延续。

记录模型、provider、日期、课程 commit、SessionId、EnrollmentId、严重问题和人工结论。凭据只通过 DSH credentials/settings 配置，不进入仓库、snapshot 或报告。

当前执行环境没有 `DEEPSEEK_API_KEY`，因此尚未运行真实模型评估；Q-006 将它定义为可选项，不用脚本 adapter 冒充真实模型。

## Human participant rubric

每名参与者记录角色背景、开始/结束时间和是否需要维护者介入。评分使用 `pass | concern | fail`：

| 项目 | 通过条件 |
|---|---|
| 角色与权限 | 能说清 Agent 会教学和检查什么，以及不会绕过哪些权限 |
| DSH 准确性 | 解释与锁定版本源码一致，没有混淆 Profile、Bundle、Preset、Plugin 或 Definition/Provider/Consumer |
| 证据纪律 | 没有机器证据时不宣称机械能力完成 |
| 错误分类 | implementation、configuration、environment、safety 结论与观察一致 |
| 提示质量 | 前两级保留思考空间，第三级才给出明确完成路径 |
| 路径适配 | 初学者和有经验开发者的推荐起点与证据一致，用户仍可跳过 |
| 恢复体验 | 恢复后无需重新描述目标，当前活动和证据一致 |

0.1.0 发布所需真人场景：

- 一名第一次接触 DSH 的 TypeScript 开发者完成最小 Tool 练习。
- 一名熟悉 Agent 框架的开发者完成诊断并获得不同起点。
- 至少一次连续失败、分层提示和 blocked 环境恢复。

当前尚无真人参与记录，因此人工 rubric 仍未通过。此状态必须在真实参与者完成试用后更新到 [`acceptance.md`](../specs/001-learning-agent-foundation/acceptance.md)。
