# Learn DeepSeek Harness

一个基于 DeepSeek Harness 插件生态构建的自适应教学 Agent，帮助开发者通过讲解、源码探索、实践任务和反馈循环，系统掌握 DSH。

> 项目状态：规格设计阶段。当前仓库定义产品范围、技术方案、实施计划、测试策略和验收标准；尚未发布可运行版本。

## 项目定位

Learn DeepSeek Harness 不维护一套与 DSH 分叉的 Agent Runtime。它把 DSH 作为运行时，通过独立插件、agent preset 和 bundle 组合出一个专门教授 DSH 的 Agent。

~~~text
DeepSeek Harness Runtime
        +
Learn DSH plugins
        +
Learn DSH curriculum and exercises
        =
Adaptive DSH teaching agent
~~~

这种方式有三个直接收益：

- 教学产品可以跟随 DSH 上游升级，不需要长期维护核心分叉。
- 课程、诊断、练习、评测和学习记录可以独立演进与替换。
- 项目本身就是一个真实的 DSH 插件开发示例。

## 教学体验

教学 Agent 遵循一个可重复的学习闭环：

1. 询问学习目标并诊断已有知识。
2. 选择当前最合适的概念和真实源码入口。
3. 用解释、追问和小例子建立概念模型。
4. 布置在隔离工作区内完成的真实 DSH 任务。
5. 使用确定性检查和教学 rubric 评估结果。
6. 区分知识遗漏、概念误解和实现失误。
7. 更新学习证据并安排下一步。

项目不会退化为固定题库或只依赖关键词匹配的问答机器人。课程定义学习目标、前置知识、证据要求和评测 rubric；具体问题和解释可以根据学习者上下文动态生成。

## 首期教学范围

MVP 覆盖以下学习路径：

- DSH、Cordis 与插件树的基本关系。
- Plugin、Service、Context、Effect 和 typed event。
- Capability seam：Service Definition、Provider 和 Consumer。
- System Prompt、Tools、Skills 和 MCP 的组合方式。
- Agent、Agent Loop、Turn、Step 与 Session Event Log。
- Profile、Bundle、Patch 和 per-agent Preset。
- 完成一个最小工具插件和一个最小 Provider。
- 将教学插件组合成可安装的 Learn DSH bundle。

## 计划中的插件

| 组件 | 职责 |
|---|---|
| curriculum | 课程图、概念、前置关系、源码锚点和练习目录 |
| learner-model | 从持久学习事件投影学习者状态和掌握证据 |
| teacher-persona | 教师身份、教学原则和分层提示策略 |
| diagnostic | 根据目标与回答选择诊断任务并记录证据 |
| lesson-planner | 根据课程依赖和学习者状态选择下一教学活动 |
| lab | 创建隔离练习工作区并限制可执行能力 |
| evaluator | 运行确定性检查，结合 rubric 生成教学反馈 |
| learn-dsh-bundle | 将教学插件和 DSH 基础能力组合成 profile patch layer |

插件边界和事件模型在 [技术设计](specs/001-learning-agent-foundation/design.md) 中定义。

## 规格驱动开发

当前有效规格是 [001-learning-agent-foundation](specs/001-learning-agent-foundation/spec.md)：

- [产品与功能规格](specs/001-learning-agent-foundation/spec.md)
- [技术设计](specs/001-learning-agent-foundation/design.md)
- [实施计划](specs/001-learning-agent-foundation/plan.md)
- [测试方案](specs/001-learning-agent-foundation/test-plan.md)
- [验收标准](specs/001-learning-agent-foundation/acceptance.md)

根目录的 [SPEC.md](SPEC.md) 是规格索引和变更规则。

## 预计使用方式

首个可运行里程碑完成后，用户将能够把 bundle 安装到独立 profile：

~~~sh
dsh plugin --profile learn-dsh add @learn-dsh/bundle
dsh --profile learn-dsh
~~~

命令属于目标接口，在首个可运行里程碑完成前不会生效。

## 仓库结构

~~~text
packages/      DSH 教学插件与 bundle
curriculum/    版本化课程、源码锚点和练习定义
exercises/     隔离练习模板与确定性检查
presets/       面向不同学习阶段的 agent preset
specs/         产品规格、设计、计划、测试和验收标准
docs/          用户与贡献者文档
~~~

实现阶段将按照规格逐步创建目录，避免在接口尚未确定时生成空壳 package。

## 非目标

- 不复制或重写 DSH Agent Loop。
- 不成为通用在线教育平台或 LMS。
- 不用固定问答替代自适应诊断。
- 不默认允许教学 Agent 修改 DSH 源码或访问宿主机敏感资源。
- 不承诺课程自动兼容任意 DSH 版本；课程与支持版本显式绑定。

## 上游关系

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开插件接口构建，初始设计基线为 0.1.0-rc.5。DSH 处于预发布阶段，因此每次上游升级都需要运行兼容性测试，并更新课程源码锚点。

本项目是独立社区项目，不代表 DeepSeek 官方产品。

## 参与开发

开始实现或修改行为前，请先阅读 [SPEC.md](SPEC.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。任何用户可见行为必须对应规格条目、测试证据和验收标准。

## License

[MIT](LICENSE)
