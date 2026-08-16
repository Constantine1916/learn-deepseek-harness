# Technical Design

## 1. 架构决策

Learn DeepSeek Harness 是 DSH 的外部教学发行版，不是 Runtime fork。产品通过 profile、bundle、plugin、preset、Service、typed event、tool 和 system-prompt contribution 组装。

~~~text
DSH host composition
├── DSH base and headless bundle
├── Learn DSH bundle
│   ├── curriculum
│   ├── learner
│   ├── teaching
│   ├── teacher-prompt
│   ├── lab
│   └── learning tools
└── learn-dsh agent preset
~~~

不修改 agent-loop。教学流程通过公共 Agent、Session Event、System Prompt、Tools、FS、Shell、Sandbox 和 Approval 能力完成。

## 2. 仓库布局

Phase 0 的实际布局：

~~~text
packages/
  teacher/          最小教师 system-prompt 插件
  bundle/           可安装 profile patch layer
examples/
  headless/         真实 Loader prompt 组装与 keyless snapshot
scripts/            兼容性、文档和 profile 安装检查
docs/               开发约定和兼容矩阵
~~~

后续阶段按出现的稳定职责扩展为：

~~~text
packages/
  curriculum/       课程 Service、验证和文件系统 Provider
  learner/          学习事件、状态投影和查询 Service
  teaching/         诊断、计划和教学活动状态机
  teacher-prompt/   教师 Persona 与当前活动上下文
  lab/              练习工作区和评测执行
  tool-learning/    面向模型的课程、练习、提示和提交工具
  bundle/           可安装的 profile patch layer
curriculum/
  foundations/      课程单元和版本清单
exercises/
  fixtures/         可复制练习模板
  checks/           确定性验收入口
presets/
  learn-dsh/        agent.cordis.yml
examples/
  headless/         keyless snapshot 的真实可运行装配
specs/
docs/
~~~

MVP 不为每个概念建立一个 package。只有独立生命周期、稳定接口或可替换 Provider 出现时才拆分。

## 3. Package 职责

### curriculum

拥有课程词汇、课程图验证、版本选择和来源解析。MVP 阶段 Service Definition 与文件系统 Provider 同包，因为数据格式和加载规则共同演进；当远程课程 Provider 出现时再拆分。

公共读取接口只返回已验证、已解析的课程规格。加载时拒绝重复 ID、缺失依赖、循环、无效版本范围、缺失 rubric 和逃逸仓库根的来源路径。

### learner

声明学习事件并把事件前缀投影成 LearnerState。提供只读查询和追加领域事件的窄接口，不提供任意覆盖整份状态的 update 方法。

### teaching

拥有诊断、计划和当前教学活动的状态转换。它选择下一活动，但不直接执行 Shell、编辑文件或调用模型。所有选择结果都追加带原因的学习事件。

### teacher-prompt

向 ctx.systemPrompt 注册稳定教师 Persona，并把当前目标、单元、证据和活动以作用域上下文加入请求。它只呈现 learner 和 teaching 的状态，不拥有状态。

### lab

创建、定位、重置练习工作区；通过 DSH FS、Shell、Subprocess、Sandbox 和 Approval 能力执行已解析的检查规格。它不能接收模型生成的任意重置路径。

### tool-learning

向 ctx.tools 注册模型可调用的领域操作，例如：

- learning_get_state
- learning_start_unit
- learning_request_hint
- learning_create_exercise
- learning_submit_evidence
- learning_run_checks
- learning_complete_activity

工具只表达领域动作。普通文件编辑和 Shell 仍由 DSH 原生工具提供并受现有策略控制。

### bundle

提供 cordis.patch.yml，挂载上述插件以及需要的 DSH 服务。bundle 不包含教学业务逻辑。

## 4. 课程模型

课程文件使用经 schema 验证的 YAML 或 JSON。概念模型：

~~~text
CourseManifest
  id
  title
  locale
  dshVersionRange
  units[]

Unit
  id
  title
  objectives[]
  prerequisites[]
  sources[]
  checkpoints[]
  exerciseIds[]
  hints[]
  rubric[]
  completionRule

Source
  repository
  version
  path
  anchor
  purpose
~~~

源码行号不是长期稳定标识。优先使用文档 heading、export 名、package 名、测试名或可校验文本 anchor；解析失败时报告不兼容，而不是静默使用相邻内容。

## 5. 学习事件与投影

建议的追加事件：

- learning/goal-set
- learning/diagnostic-started
- learning/evidence-recorded
- learning/plan-created
- learning/plan-adjusted
- learning/unit-started
- learning/exercise-created
- learning/checks-completed
- learning/hint-used
- learning/misconception-recorded
- learning/mastery-changed
- learning/unit-completed
- learning/course-completed

事件携带稳定 CourseId、UnitId、ExerciseAttemptId 和 EvidenceId。跨 package 的不透明 ID 使用 branded 类型。

LearnerState 是纯投影，至少包含：

~~~text
goal
activePlan
currentActivity
unitProgress
attempts
evidence
misconceptions
mastery
nextRecommendation
~~~

mastery 变化引用 EvidenceId 和 reason code。重放不执行外部命令，不再次创建练习，也不重复发放完成状态。

## 6. 教学规划

规划器输入为已验证课程图、学习目标、LearnerState 和当前支持版本，输出带解释的活动：

~~~text
explain | question | inspect-source | exercise | remediate | review | complete
~~~

MVP 使用确定性的候选筛选：

1. 删除版本不兼容单元。
2. 删除先修未满足单元。
3. 优先处理活动中的失败证据和已识别误区。
4. 然后选择通向学习目标的最短未完成单元。
5. 只有达到 completion rule 时才允许跳过。

模型可以在候选活动内生成解释或问题，但不能绕过候选筛选和完成规则。

## 7. 评测模型

Evidence 分为：

- machine：测试、类型检查、构建、配置树、导出或事件断言。
- authored：学习者提交的解释、预测或设计。
- observed：工具调用、提示使用和尝试历史。

确定性检查生成结构化结果：

~~~text
checkId
status: passed | failed | blocked
category: implementation | configuration | environment | safety
summary
details
artifacts
~~~

模型基于结构化结果和 rubric 生成反馈。blocked 不得计为学习失败；环境恢复后可以重新执行。实践类完成规则至少要求一条 machine evidence。

## 8. Prompt 与工具策略

稳定 Persona 保持简洁并尽量形成可复用前缀。当前单元、活动和学习状态作为动态上下文注入。

Prompt 约束：

- 不虚构源码内容或检查结果。
- 未运行检查时不得宣称练习通过。
- 提示按当前允许级别提供。
- 完整答案只有在学习者明确请求或活动进入讲解复盘时提供。
- 计划和掌握变化通过工具提交，不能只写在自然语言回复中。

工具可见性按活动限制。例如讲解阶段隐藏重置和提交工具，练习阶段开放 lab 工具；restriction 必须同时约束展示、查找和执行。

## 9. 实践环境与安全

- 每次尝试使用独立 ExerciseAttemptId 和已解析绝对目录。
- DSH checkout 作为只读来源；练习模板复制到 attempt 目录。
- 允许命令来自版本化 exercise check spec，不直接拼接模型文本。
- 学习者主动使用 Shell 时继续经过 DSH sandbox 和 approval。
- reset 先验证目录归属，只删除或重建当前 attempt。
- 日志和 fixture 禁止包含 API key、用户凭据和主机环境快照。
- 课程文件视为持久输入边界，加载时执行 schema 和路径验证。

## 10. Bundle 与 Preset

bundle 依赖 DSH 基础能力并挂载 Learn DSH 插件。开发安装：

~~~sh
dsh plugin --profile learn-dsh add ./packages/bundle
~~~

Phase 0 的自定义 `learn-dsh` profile 由 DSH 标准插件命令初始化为 base layer，再追加 Learn DSH bundle。它用于验证外部安装和配置组合；完整 headless surface 与 agent preset 在后续阶段加入。Phase 0 的 `examples/headless` 通过 DSH app boot 和真实 Cordis Loader 组装 prompt，不手工模拟 Loader。

发布后安装：

~~~sh
dsh plugin --profile learn-dsh add @learn-dsh/bundle
~~~

preset 只携带单 Agent 的 Persona、课程上下文和教学工具限制；进程级课程注册、持久化和基础 DSH 服务留在 host composition。

## 11. 版本策略

- package 版本遵循 SemVer。
- 每次发布声明精确测试过的 DSH 版本范围。
- 课程 manifest 单独声明适用版本范围。
- DSH 仍为预发布时，不使用宽泛的无上限兼容范围。
- CI 验证支持范围内的最低和最高版本。
- 不兼容升级通过新规格记录接口、课程和迁移变化。
- Phase 0 精确支持 DSH `0.1.0-rc.5` 与 checkout commit `0cf6f648c80de1b0572057cd746a20863e39d606`。
- 由于该版本未发布完整 npm 包集，开发依赖使用相邻 `../deepseek-harness` checkout 的 `link:`；发布前必须改为同一受测版本的已发布包或先更新规格与兼容矩阵。

## 12. 配置

部署可调值必须进入经验证的 Config：

- curriculumRoots
- supportedDshRange
- workspaceRoot
- maxAttemptsPerExercise
- defaultHintPolicy
- maxSourceBytesPerActivity
- optionalRealModelEval

安全不变量、事件类型和协议常量保持固定。缺少课程根、目标版本或练习 fixture 时在最早可解析点失败，不静默跳过。

## 13. 未来扩展

MVP 后可以拆出远程 curriculum Provider、Web 学习节点、团队进度后端、间隔复习策略和课程作者工具。新增能力仍先判断是否构成完整 capability seam。
