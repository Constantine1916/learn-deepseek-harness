# Technical Design

## 1. 架构决策

Learn DeepSeek Harness 是 DSH 的外部教学发行版，不是 Runtime fork。产品通过 profile、bundle、plugin、preset、Service、typed event、tool 和 system-prompt contribution 组装。

~~~text
DSH host composition
├── DSH base and headless bundle
├── Learn DSH bundle
│   ├── curriculum
│   ├── learner
│   ├── learner-memory
│   ├── teaching
│   ├── teacher-prompt
│   ├── lab
│   └── learning tools
└── learn-dsh agent preset
~~~

不修改 agent-loop。教学流程通过公共 Agent、System Prompt、Tools、Storage、FS、Shell、Sandbox 和 Approval 能力完成；DSH Session Log 记录单次会话，Learner Event Store 记录跨会话学习状态。

## 2. 仓库布局

当前实际布局：

~~~text
packages/
  curriculum/       课程 schema、图验证、内容入口和来源 anchor
  learner-memory/   追加式学习事件持久化 Service 与本地 Provider
  learner/          学习事件、纯投影和查询/追加 Service
  lab/              练习工作区 Service 与 sandboxed 本地 Provider
  teaching/         确定性规划和教学活动状态机
  teacher/          教师 Persona 与 LearnerState 动态上下文
  tool-learning/    面向模型的学习状态与活动工具
  bundle/           可安装 profile patch layer
examples/
  headless/         真实 Loader、Agent Loop、Lab 与 Session Log keyless snapshot
scripts/            兼容性、文档和 profile 安装检查
docs/               开发约定和兼容矩阵
~~~

后续阶段继续补充诊断、提示、完整课程和发布入口；不为这些职责预建空 package：

~~~text
packages/
  curriculum/       课程 Service、验证和文件系统 Provider
  learner/          学习事件、状态投影和查询 Service
  learner-memory/   追加式学习事件持久化 Service 与本地 Provider
  teaching/         诊断、计划和教学活动状态机
  teacher/          教师 Persona 与当前活动上下文
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

声明学习事件并把 Learner Event Store 的事件前缀投影成 LearnerState。提供只读查询和追加领域事件的窄接口，不提供任意覆盖整份状态的 update 方法。学习事件通过 LearnerId 和 EnrollmentId 形成长期学习范围，并记录触发该事件的 SessionId。

`learning/*` 是 Learn DSH 领域事件，不声明为 DSH `SessionEventMap` 成员。DSH `0.1.0-rc.5` 与已核对的 `0.1.0-rc.6` 没有树外必需 Session event 的公开持久化注册入口；项目不得修改 `KNOWN_SESSION_EVENT_TYPES`、使用其他 DSH 事件名承载学习语义或把必需学习事件标记为 `ignorable`。

### learner-memory

拥有 `ctx.learnerMemory` Service Definition、持久事件 envelope、读取前缀、原子追加、flush 和损坏诊断。MVP 提供本地持久 Provider；远程或团队 Provider 出现前，Service Definition 与本地 Provider 可以同包演进。

Consumer 以 LearnerId 和 EnrollmentId 读取有序事件，以 EventId 或命令 ID 保证追加幂等。Provider 不解释 mastery 或课程完成规则，只保存和读取经 schema 验证的领域事件。缺失 Provider、序号断裂、未知必需事件版本或损坏记录必须明确失败，不能退化为空学习历史。

### teaching

拥有诊断、计划和当前教学活动的状态转换。它选择下一活动，但不直接执行 Shell、编辑文件或调用模型。所有选择结果都追加带原因的学习事件。

Phase 2 使用以下最小确定性活动状态机完成第一个纵向切片：

~~~text
explain -> checkpoint -> exercise -> feedback
                              ^          |
                              | failed   | passed
                              +----------+------> unit completed
~~~

`learning/unit-started` 建立 `explain` 活动；`learning/activity-advanced` 记录显式转换、原因和可选 attempt；`learning/exercise-created`、`learning/checks-completed` 和 `learning/unit-completed` 继续保存领域事实。转换必须验证当前活动、单元和 attempt，不能由模型直接指定任意下一状态。

Phase 2 的最小规划器只选择版本兼容、先修已完成且尚未完成的第一个计划单元。模型可以请求开始单元，但 teaching Service 必须拒绝跳过该确定性候选的请求。

### teacher-prompt

向 ctx.systemPrompt 注册稳定教师 Persona，并把当前目标、单元、证据和活动以作用域上下文加入请求。它只呈现 learner 和 teaching 的状态，不拥有状态。

### lab

创建、定位、重置练习工作区；通过 DSH FS、Shell、Subprocess、Sandbox 和 Approval 能力执行已解析的检查规格。它不能接收模型生成的任意重置路径。

`ctx.lab` 是可替换的 Service Definition；本地 Provider 使用 DSH `ctx.fs` 解析和验证路径，使用 `ctx.shell` 执行受信任的 fixture 准备器和检查入口，并把调用 Session 解析出的 `ctx.sandboxPolicy` 传给每次执行。模型只能传递已加载的 ExerciseId/AttemptId，不能传目录或命令。

Phase 2 的一个 fixture 使用课程声明的 `runner: node` 和安全相对 `entry`。Lab 根据固定 runner 构造命令；课程和模型都不能提供 shell 源码。attempt 目录带有身份 marker，reset 必须同时验证目录属于配置 workspace root 且 marker 与 LearnerId、EnrollmentId、ExerciseAttemptId 一致。

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

Phase 2 首先交付三个工具：

- `learning_get_state`：只读取当前 Session 绑定 Enrollment 的已提交状态。
- `learning_start_unit`：使用确定性规划器建立 enrollment/goal/plan（缺失时）并开始唯一允许的单元。
- `learning_complete_activity`：根据当前活动完成 explain、checkpoint、exercise 或 feedback；checkpoint 创建隔离 attempt，exercise 运行确定性检查，feedback 只有在已提交 machine evidence 后才能完成单元。

写工具要求调用方提供稳定 `command_id`。一个工具需要追加多个领域事件时，从该根 ID 确定性派生各事件的 EventId/CommandId，使崩溃后的同命令重试可以继续而不会重复授予证据或完成状态。

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
  exercises[]
  hints[]
  rubric[]
  completionRule

Exercise
  id
  title
  kind
  fixture
  checks[]

ExerciseCheck
  id
  runner: node
  entry
  timeoutMs
  category

Source
  repository
  version
  path
  anchor
  purpose
~~~

`fixture` 和 check `entry` 都是安全相对路径。Phase 2 不接受课程提供的任意 shell command；本地 Lab Provider 只支持显式 runner，并由 runner 与 entry 构造执行。

课程 package 在没有 DSH source root 时仍校验 schema、SemVer、图关系和相对路径安全；文件存在性与 anchor 匹配在 source root 可解析时立即校验。默认随包发布的 manifest 始终完成前一组验证，真实 headless example 还必须针对锁定的相邻 DSH checkout 完成后一组验证。

源码行号不是长期稳定标识。优先使用文档 heading、export 名、package 名、测试名或可校验文本 anchor；解析失败时报告不兼容，而不是静默使用相邻内容。

## 5. 长期学习记忆、事件与投影

建议的追加事件：

- learning/goal-set
- learning/diagnostic-started
- learning/evidence-recorded
- learning/plan-created
- learning/plan-adjusted
- learning/unit-started
- learning/activity-advanced
- learning/exercise-created
- learning/checks-completed
- learning/hint-used
- learning/misconception-recorded
- learning/mastery-changed
- learning/unit-completed
- learning/course-completed

事件携带稳定 CourseId、UnitId、ExerciseAttemptId 和 EvidenceId。跨 package 的不透明 ID 使用 branded 类型。

持久 envelope 还包含：

~~~text
eventId
learnerId
enrollmentId
sourceSessionId
seq
time
type
version
data
~~~

LearnerId 表示学习者身份；EnrollmentId 表示一次课程学习关系。一个 Enrollment 可以关联多个 DSH Session，新的 Session 通过相同 LearnerId、EnrollmentId 延续长期状态。不同 Learner 或不同 Enrollment 的事件前缀必须物理或逻辑隔离。

MVP 的 LearnerId 由受信任 host 配置或身份 Provider 解析，不接受模型自由文本作为身份。EnrollmentId 由 learner Service 创建并持久化，Session 只引用已经解析的 LearnerId、EnrollmentId；未来账户系统不是 MVP 前置条件。

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

Learner Event Store 是学习领域历史真源，DSH Session Log 是单次会话和模型请求审计真源。领域写操作遵循：

1. 校验命令与引用。
2. 以稳定 EventId 或命令 ID 向 learner-memory 追加事件。
3. 等待持久化成功。
4. 更新或重放 LearnerState。
5. 才向工具调用方报告成功。

系统不宣称 Learner Event Store 与 DSH Session persistence 存在跨库事务。崩溃重试通过稳定 ID 幂等；模型请求只读取已经提交的 LearnerState。

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

### 6.1 Phase 3 诊断与显式跳过

诊断候选不是固定题单。`teaching` 从目标路径中每个单元的 `objectives`、`completion.requiredRubricIds` 和对应 rubric 动态生成候选；每个候选稳定绑定 `DiagnosticCandidateId`、UnitId、RubricId、一个 objective、允许的 EvidenceKind，以及适用的课程 source 引用。

诊断提交把每个候选标记为 `meets | gap | uncertain`：

- `meets` 必须提交该 rubric 允许类型的证据；`observed` 证据必须引用当前单元课程中已验证的 source anchor，`machine` 证据必须引用 Learner Event Store 中已经提交的通过检查证据。
- `gap` 追加误区事件，并使对应单元优先进入补课路径。
- `uncertain` 保留明确的不确定项，不授予证据或跳课资格。

规划器为每个目标路径单元计算 `waiverEligibility`。只有全部 required rubric 都有 `meets` 证据，且至少一条匹配证据为 `observed` 或 `machine` 时才 eligible。资格只用于展示；学习者显式请求后，`teaching` 必须重新校验并追加 `learning/unit-waived`。事件记录 EvidenceId、reason 和来源 SessionId；投影使用独立 `waived` 进度，允许满足后续先修，但报告不得把它描述为练习完成。

诊断完成后创建包含完整目标路径的计划。确定性排序先满足前置关系，再优先包含 unresolved misconception 的可开始单元，最后按通向目标 outcome 的稳定拓扑顺序选择。每次计划创建或调整都保存 evidence 引用；模型不能自行声明某单元 eligible 或 waived。

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

teacher-prompt 从 `ctx.learner` 读取已提交 LearnerState，生成结构化上下文和可选自然语言摘要。每次实际进入模型请求的状态必须通过 DSH 已有请求上下文机制记录为 Session Log 快照；摘要和快照均可重新生成，不作为 Learner Event Store 的替代品。

Phase 2 使用 `ctx.systemPrompt.context()` 注册命名动态上下文。DSH Agent Loop 在每次 prompt assembly 后把变化后的完整 runtime-context snapshot 作为 plugin 来源的 `user/message` 追加到 Session Log；该文本包含规范 JSON 的 LearnerState 与课程/活动摘要。对应模型请求的 `request/header` 继续记录实际 system prompt 和 tool schemas。测试必须断言模型收到的 LearnerState 文本与 Session Log 中的快照逐字一致。

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
- learner-memory 根目录来自验证后的配置，不能解析到 DSH checkout、HOME 根或未授权目录；事件 payload、版本、序号和身份字段在持久读取边界验证。
- Session 中的 LearnerId、EnrollmentId 只用于选择已配置且受信任的本地记录，不触发自动安装插件、下载代码或连接未配置后端。

## 10. Bundle 与 Preset

bundle 依赖 DSH 基础能力并挂载 Learn DSH 插件。开发安装：

~~~sh
dsh plugin --profile learn-dsh add ./packages/bundle
~~~

自定义 `learn-dsh` profile 由 DSH 标准插件命令初始化为 base layer，再追加 Learn DSH bundle。它用于验证外部安装和配置组合；交互式 CLI surface 与 agent preset 在后续阶段加入。`examples/headless` 通过 DSH app boot、真实 Cordis Loader、公共 Agent Loop、脚本 LLM adapter、sandboxed Lab 和 JSONL Session persistence 执行 Phase 2 教学闭环，不手工模拟请求或 Session Log。

发布后安装：

~~~sh
dsh plugin --profile learn-dsh add @learn-dsh/bundle
~~~

preset 只携带单 Agent 的 Persona、课程上下文和教学工具限制；进程级课程注册、learner-memory Provider 和基础 DSH 服务留在 host composition。

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
- learnerMemoryRoot
- learnerIdentity
- supportedDshRange
- workspaceRoot
- maxAttemptsPerExercise
- defaultHintPolicy
- maxSourceBytesPerActivity
- optionalRealModelEval

安全不变量、事件类型和协议常量保持固定。缺少课程根、目标版本或练习 fixture 时在最早可解析点失败，不静默跳过。

## 13. 未来扩展

MVP 后可以拆出远程 curriculum Provider、团队 learner-memory Provider、Web 学习节点、间隔复习策略和课程作者工具。若 DSH 后续提供版本化的树外 Session event vocabulary，Learn DSH 可以评估适配器或迁移路径，但不把该上游能力作为长期学习记忆的前置条件。新增能力仍先判断是否构成完整 capability seam。
