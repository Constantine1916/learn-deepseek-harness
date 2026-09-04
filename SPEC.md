# Specification Index

Learn DeepSeek Harness 使用规格驱动开发。规格不是一次性的规划文档，而是产品行为、技术设计、测试证据和验收结论之间的可追踪依据。

## 当前规格

| ID | 名称 | 状态 | 目标 |
|---|---|---|---|
| 001 | [Learning Agent Foundation](specs/001-learning-agent-foundation/spec.md) | Implementing | 建立可运行的 Learn DSH bundle、教学闭环、学习事件模型和 MVP 课程 |

配套文档：

- [技术设计](specs/001-learning-agent-foundation/design.md)
- [实施计划](specs/001-learning-agent-foundation/plan.md)
- [测试方案](specs/001-learning-agent-foundation/test-plan.md)
- [验收标准](specs/001-learning-agent-foundation/acceptance.md)

## 规格状态

- Draft：问题、范围和方案正在讨论，不授权实现稳定接口。
- Approved：范围和验收标准已确认，可以进入实现。
- Implementing：至少一个计划任务正在开发。
- Validating：功能已完成，正在收集测试和验收证据。
- Accepted：全部强制验收标准通过。
- Superseded：由新规格替代，保留历史但不再作为当前依据。

## 变更规则

1. 新行为先修改规格，再修改实现。
2. 每项功能需求必须拥有稳定 ID。
3. 实施计划中的任务必须引用需求 ID。
4. 测试必须说明它证明的需求或质量属性。
5. 验收项必须包含可观察结果和所需证据。
6. 范围变化需要同时更新非目标、风险和里程碑。
7. 已接受规格发生不兼容变化时，创建新规格并标记替代关系。

## 完成定义

一项规格只有在以下条件全部满足时才能标记 Accepted：

- 所有 Must 级需求已经实现。
- 强制测试门禁通过。
- 每项验收标准均有可复现证据。
- 用户文档与实际行为一致。
- 支持的 DSH 版本和已知限制已经记录。
- 不存在未决的高风险安全或数据完整性问题。
