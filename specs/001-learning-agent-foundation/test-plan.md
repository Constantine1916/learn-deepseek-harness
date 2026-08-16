# Test Plan

## 1. 测试目标

测试必须证明三个不同层面：

1. 领域逻辑正确：课程、事件、计划、完成规则和评测稳定。
2. DSH 组合正确：插件生命周期、作用域、Session 重放、工具和 bundle 按公开接口工作。
3. 教学体验达标：Agent 不跳过证据、不提前泄露答案，并能完成真实教学闭环。

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
- 候选活动筛选与先修判断。
- completion rule。
- 提示级别和泄露保护。
- 检查结果分类。
- 练习目录归属和 reset 目标解析。

目标：packages 下业务源文件保持每文件 100% statement、branch、function 和 line coverage。对纯类型、生成代码或不可执行声明使用窄且有说明的例外。

### 2.3 Plugin 集成测试

在真实 Cordis/DSH Context 上验证：

- 插件加载、注册、dispose 和重复注册错误。
- scoped prompt 与全局 prompt 的组合。
- scoped tool 可见性、lookup 和执行一致。
- 学习事件写入 Session Log 并重放。
- 多 Agent 或多 Session 隔离。
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
- Session 恢复。
- 学习报告。

快照重点固定事件、工具调用、课程 ID、状态变化和必须出现的反馈字段。自然语言允许通过受控 fixture 保持稳定，不使用宽泛 normalizer 隐藏真实回归。

### 2.5 端到端测试

在安装后的 DSH Runtime 上执行：

1. 创建干净 learn-dsh profile。
2. 安装本地或发布 bundle。
3. 启动 headless 教学 Agent。
4. 完成一个 Tool 插件练习。
5. 停止并恢复 Session。
6. 验证学习状态和工作区。
7. 卸载 bundle。

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
- 练习模板和检查是否仍通过。

## 5. 故障注入

必须覆盖：

- 课程文件损坏。
- 来源 anchor 消失。
- 检查进程超时或被取消。
- Session 在练习执行后、结果提交前恢复。
- 重复提交同一个 EvidenceId。
- bundle dispose 发生在活动课程中。
- DSH Provider 缺失或配置无效。

系统必须给出明确诊断，不得静默跳过或错误授予完成状态。

## 6. 需求追踪

测试名称或元数据必须引用 F/Q ID。例如：

~~~text
F-003 rejects a cyclic curriculum graph
F-011 replays one learner state without cross-session leakage
Q-003 rejects reset outside the resolved attempt directory
~~~

验收证据汇总到 [acceptance.md](acceptance.md)，不在多个文档复制测试结果。

## 7. Phase 0 门禁

Phase 0 的可复现入口：

- `pnpm lint`：检查 packages、examples、scripts 和测试配置。
- `pnpm typecheck`：strict 检查可发布源码、example、测试和 Vitest 配置。
- `pnpm test:unit`：验证 bundle patch 组合和教师插件 dispose。
- `pnpm test:snapshot`：通过真实 DSH app boot 与 Cordis Loader 固定教师 prompt。
- `pnpm build`：构建两个公开包和 headless example。
- `pnpm docs:check`：检查仓库 Markdown 相对链接。
- `pnpm compat`：检查 DSH 版本、checkout commit、Node 范围和 peer 声明。
- `pnpm test:profile`：在临时 `DSH_HOME` 中安装 bundle、检查 `dump-config`，再移除并检查无残留配置行。

## 8. Phase 1 课程基础证据

- `pnpm test:unit`：验证课程 schema、SemVer、重复 ID、缺失先修、循环、completion 引用、路径安全、四类来源 anchor、symlink 逃逸和 curriculum Service dispose/reload。
- `pnpm test:snapshot`：通过真实 DSH app boot 与 Cordis Loader 加载 curriculum Service，并固定课程 ID、单元、内容入口和已解析来源 anchor。
- `pnpm test:profile`：安装后的 profile 同时出现 curriculum 与 teacher 行，移除 bundle 后两者均无残留。

P1-03 至 P1-05 的 Session replay、幂等与隔离证据尚未建立；DSH persistence reader 缺少树外必需事件注册入口时，不以仅内存测试替代恢复验收。
