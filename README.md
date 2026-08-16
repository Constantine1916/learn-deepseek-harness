# Learn DeepSeek Harness

一个基于 DeepSeek Harness 插件生态构建的自适应教学 Agent，帮助开发者通过讲解、源码探索、实践任务和反馈循环，系统掌握 DSH。

> 项目状态：Phase 0–4 已实现，Phase 5 本地发布准备进行中。当前版本已经具备覆盖八项成果的四个连续 foundations 单元、独立追加式 Learner Event Store、课程派生诊断、用户控制的显式跳课、三级提示、Provider/Tool/Bundle 实践、四类检查结果、学习报告、精确 Session Log 状态快照，以及真实 Agent Loop keyless 教学闭环；registry 发布、真实模型人工验收和交互式 UI 尚未完成。

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

## 插件与计划组件

| 组件 | 职责 |
|---|---|
| curriculum | 课程图、概念、前置关系、源码锚点和练习目录 |
| learner-memory | 持久化按 LearnerId/EnrollmentId 隔离的追加式学习事件 |
| learner | 从持久学习事件投影状态，并提供查询、追加、幂等和 flush 接口 |
| teaching | 绑定 Session 与 Enrollment，执行确定性计划和教学活动状态机 |
| teacher | 注入教师 Persona 和模型实际看到的已提交 LearnerState |
| tool-learning | 提供状态、诊断、用户控制的显式跳课、计划调整、开始单元和完成活动工具 |
| lab | 通过 DSH sandboxed FS/Shell 创建、重置练习并运行确定性检查 |
| learn-dsh-bundle | 将教学插件和 DSH 基础能力组合成 profile patch layer |

诊断、自适应计划、显式跳课、三级提示和学习报告均通过现有 teaching/learner/tool seam 提供，不需要修改 DSH Agent Loop。诊断只影响推荐；用户可以直接跳过计划中的未完成单元，跳过不会被报告为掌握或练习完成。

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

首次准备时，先在相邻的 DSH checkout 安装依赖并构建 host packages：

~~~sh
cd ../deepseek-harness
git checkout 0cf6f648c80de1b0572057cd746a20863e39d606
pnpm install --frozen-lockfile
pnpm build:lib:host
~~~

然后在本仓库安装并验证：

~~~sh
cd ../learn-deepseek-harness
pnpm install --frozen-lockfile
pnpm compat
pnpm build
~~~

运行不需要 API key 的真实 Agent Loop 教学闭环：

~~~sh
pnpm example:headless
~~~

输出固定真实 Loader/Agent Loop 看到的教师 prompt 和学习工具，并覆盖初学者诊断、有经验开发者在诊断仍有 uncertain 时显式跳课、四个连续单元、三级提示、implementation 失败、environment blocked 同 attempt 重试、Provider/Tool/Bundle machine evidence、综合验证、学习报告、原 Session 恢复和同 Enrollment 新 Session 延续。场景会逐次断言模型收到的 LearnerState 与对应 DSH Session Log 快照完全一致。

安装本地 `learn-dsh` agent preset：

~~~sh
pnpm build
pnpm preset:install
pnpm preset:check
~~~

然后把 bundle 安装到 DSH 的 `web` profile，并启动真实交互 surface：

~~~sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/learn-deepseek-harness/packages/bundle
pnpm dsh --profile web --help
pnpm dsh --profile web
~~~

浏览器中新建 Session 时选择 `Learn DSH` preset。真实模型对话需要先通过 DSH 的 Models/settings 配置 provider 与凭据；凭据不要写入本仓库。preset 只挂载教师 Persona、学习工具和必要的 agent-side 文件/Shell 工具，课程、长期记忆、Lab 和 teaching 状态机由 profile 中的 bundle host rows 提供。

卸载时分别移除 profile bundle 与受管 preset：

~~~sh
cd ../deepseek-harness
pnpm dsh plugin --profile web remove @learn-dsh/bundle
cd ../learn-deepseek-harness
pnpm preset:remove
~~~

验证标准外部 profile 安装、`dump-config` 和移除，不会写入真实 `~/.dsh`：

~~~sh
pnpm test:profile
~~~

安装测试会在临时 `DSH_HOME` 中验证 preset install/check/remove、web profile bundle 安装、真实 app-owned `--help` surface、卸载和重装。完整 keyless 教学证据仍由 `examples/headless` 提供。

课程扩展见 [课程作者指南](docs/course-authoring.md)，教学质量验收见 [教学评估协议](docs/teaching-evaluation.md)，环境与运行故障见 [故障排查](docs/troubleshooting.md)，发布候选边界见 [发布检查](docs/release.md)。

## 仓库结构

~~~text
packages/curriculum/  课程 schema、图验证、内容入口和 DSH 来源 anchor
packages/learner-memory/ 追加式 Learner Event Store Service 与本地 Provider
packages/learner/     学习事件、纯投影和 learner 查询/追加 Service
packages/lab/         练习工作区/check Service Definition 与 sandboxed 本地 Provider
packages/teaching/    确定性规划、Session 绑定和教学活动状态机
packages/teacher/     教师 Persona 与 LearnerState 动态上下文
packages/tool-learning/ 模型可调用的诊断、计划与教学领域工具
packages/bundle/      可安装的 DSH host patch、learn-dsh preset 与 setup CLI
examples/headless/    真实 Loader、Agent Loop 与 Session Log keyless 教学闭环
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
pnpm eval:teaching:keyless
pnpm test:coverage
pnpm build
pnpm docs:check
pnpm compat
pnpm security:check
pnpm test:profile
pnpm release:check
pnpm check
~~~

`pnpm check` 依次运行以上全部门禁。`release:check` 会打包八个公开 tarball，在临时 consumer 中安装并导入它们，再从打包产物验证 profile 安装、卸载和重装。测试和 example 均不使用模型 key，也不硬编码模型输出。

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
- foundations 课程当前包含四个线性单元并覆盖八项 MVP 学习成果；更多课程、多语言和非线性路径不在 0.1.0 范围。
- 当前诊断由课程 objectives 和 required rubric 派生并影响推荐顺序；跳课只要求用户显式请求，不受 gap、uncertain 或证据缺失阻止。skipped 单元满足导航先修，但不计为 mastery、练习完成或已验证能力。
- 三级提示按 attempt 顺序持久化；前两级通过课程加载门禁限制 fenced code、完整答案措辞和长度。该门禁不能替代课程作者人工教学复核。
- `examples/headless` 使用脚本 LLM adapter 提供稳定 keyless 证据；`learn-dsh` preset 和 web profile 启动入口已提供，但当前执行环境没有真实模型凭据，真人教学验收也尚未完成。
- bundle host patch 要求 profile 提供 Agent/System Prompt/Tools、agent-preset roster、sandboxed FS/Shell 和 Session 能力；当前 web profile gate 验证 preset 发现、安装、app surface、移除和重装，真实模型教学质量仍需独立评估。
- 长期学习状态由独立 learner-memory 保存，不依赖树外 DSH Session event；DSH Session Log 只保存单次会话以及模型实际收到的精确 LearnerState 快照。
- 当前 Learner Event Store 必需 payload version 为 2；version 1 记录会报告 unsupported-version，需要使用新的 Enrollment 或显式离线迁移。
- 本地 learner-memory Provider 面向单 host 进程；多个独立进程不能同时写同一存储根。团队或多进程共享需要后续远程 Provider。

本项目是独立社区项目，不代表 DeepSeek 官方产品。

## 参与开发

开始实现或修改行为前，请先阅读 [SPEC.md](SPEC.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。任何用户可见行为必须对应规格条目、测试证据和验收标准。

## License

[MIT](LICENSE)
