# Learn DeepSeek Harness

一个基于 DeepSeek Harness 插件生态构建的自适应教学 Agent，帮助开发者通过讲解、源码探索、实践任务和反馈循环，系统掌握 DSH。

> 项目状态：Phase 0 工程与兼容性基线，以及 Phase 1 的课程基础切片已实现。当前版本提供最小教师插件、版本化 foundations 课程、课程图与来源 anchor 校验、可安装 bundle、真实 Loader headless example 和基础门禁；诊断、持久 learner state、练习与 Web UI 尚未实现。

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

## 当前快速开始

当前实现精确支持 DSH `0.1.0-rc.5` 和 Node.js `^22.19.0 || >=24.0.0`。由于该 DSH 版本的包未发布到 npm，开发环境要求两个仓库相邻：

~~~text
code/
├── deepseek-harness/
└── learn-deepseek-harness/
~~~

准备并验证：

~~~sh
nvm use
pnpm install
pnpm compat
pnpm build
~~~

运行不需要 API key 的真实 Loader prompt example：

~~~sh
pnpm example:headless
~~~

输出包含 DSH harness identity、`learn-dsh:teacher` section、最终组装后的教师 prompt，以及由真实 curriculum Service 加载并针对锁定上游 checkout 验证过的课程和来源 anchor。

验证标准外部 profile 安装、`dump-config` 和移除，不会写入真实 `~/.dsh`：

~~~sh
pnpm test:profile
~~~

如需手动安装到自己的 profile，在上游 DSH checkout 中运行：

~~~sh
pnpm dsh plugin --profile learn-dsh add /absolute/path/to/learn-deepseek-harness/packages/bundle
pnpm dsh --profile learn-dsh --dump-config
pnpm dsh plugin --profile learn-dsh remove @learn-dsh/bundle
~~~

当前 `learn-dsh` profile 只证明外部 bundle 组合；可交互的完整教学 Agent 会在后续阶段加入。

## 仓库结构

~~~text
packages/curriculum/  课程 schema、图验证、内容入口和 DSH 来源 anchor
packages/teacher/     最小教师 system-prompt 插件
packages/bundle/      可安装的 DSH profile patch layer
examples/headless/    真实 Loader keyless runnable example
scripts/              兼容性、文档和 profile 安装检查
specs/                产品规格、设计、计划、测试和验收标准
docs/                 开发约定和兼容矩阵
~~~

包命名和边界见 [开发约定](docs/development.md)。后续阶段需要的目录只在对应职责开始实现时创建，不预建空壳。

## 开发门禁

~~~sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:snapshot
pnpm build
pnpm docs:check
pnpm compat
pnpm test:profile
pnpm check
~~~

`pnpm check` 依次运行以上全部门禁。测试和 example 均不使用模型 key，也不硬编码模型输出。

## 非目标

- 不复制或重写 DSH Agent Loop。
- 不成为通用在线教育平台或 LMS。
- 不用固定问答替代自适应诊断。
- 不默认允许教学 Agent 修改 DSH 源码或访问宿主机敏感资源。
- 不承诺课程自动兼容任意 DSH 版本；课程与支持版本显式绑定。

## 上游关系

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开插件接口构建。精确版本、Node 范围、开发 checkout commit 和依赖方式见 [兼容矩阵](docs/compatibility.md)。DSH 处于预发布阶段，因此扩大版本范围前必须先更新规格并运行兼容性检查。

## 当前已知限制

- DSH `0.1.0-rc.5` 依赖通过相邻 checkout 的本地 `link:` 解析；当前不能从 npm 完成同版本干净安装。
- 课程目前只有第一个 foundations 单元；完整八项学习成果和连续课程在 Phase 4 完成。
- 教师插件只注册稳定 Persona section；没有诊断、教学工具或练习执行。
- `learn-dsh` profile 尚不是完整 headless Agent surface；真实 prompt 组装由 `examples/headless` 证明。
- DSH `0.1.0-rc.5` 和已核对的 `0.1.0-rc.6` 都没有树外必需 Session event 的公开持久化注册入口。长期学习状态将由独立、追加式 learner-memory plugin 保存；DSH Session Log 只记录单次会话和模型实际收到的学习状态快照。该能力尚未实现。

本项目是独立社区项目，不代表 DeepSeek 官方产品。

## 参与开发

开始实现或修改行为前，请先阅读 [SPEC.md](SPEC.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。任何用户可见行为必须对应规格条目、测试证据和验收标准。

## License

[MIT](LICENSE)
