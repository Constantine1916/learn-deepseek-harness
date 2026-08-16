# Course authoring

Learn DSH 课程是版本化领域输入，不是自由格式 prompt。课程作者需要同时提供 manifest、课程正文、练习 fixture 和确定性检查，并让每项完成结论能够回到明确证据。

## 从现有课程开始

首版权威示例是 [`course.yml`](../packages/curriculum/curriculum/foundations/course.yml)。复制结构时保持以下层次：

1. course 声明精确 SemVer、locale、DSH 版本范围和 learning outcomes。
2. unit 声明 outcome、objectives、prerequisites、正文入口和锁定的 DSH 来源。
3. checkpoint 要求学习者产出 `authored` 或引用真实来源的 `observed` 证据。
4. exercise 只引用受信任 fixture 和固定 `node` check entry；模型不能提供命令或路径。
5. rubric 声明允许的证据类型；completion 只引用本单元已声明的 checkpoint、exercise 和 rubric ID。
6. hints 必须严格包含 1、2、3 级。前两级各不超过 280 字符，不能包含 fenced code 或完整实现措辞。

所有 ID 在各自作用域内必须唯一。路径必须是安全相对路径；课程图不能缺失前置或形成环。

## 锁定 DSH 来源

每条 source 必须包含：

- `repository: deepseek-harness`
- 40 位完整 commit
- checkout 内安全相对路径
- `heading`、`export`、`symbol` 或 `text` 类型的稳定 anchor
- 该来源服务于当前目标的 purpose

更新 DSH 基线时，不要只改版本字符串。先在新 checkout 中验证每个路径和 anchor，再复核课程解释与练习是否仍然成立。

## 练习与检查

本地 Lab Provider 默认从 `packages/lab/fixtures` 读取 fixture。自定义课程部署时必须把 curriculum 的 `manifestPath` 与 Lab 的 `fixtureRoot` 一起指向同一受控发布物，不能让 Session 或模型决定它们。

检查只能执行 manifest 中声明的 `runner: node` 与安全相对 `entry`。根据失败含义选择 `implementation`、`configuration`、`environment` 或 `safety`；机械可判断的实践完成必须产生 machine evidence。

## 验证清单

提交课程改动前运行：

~~~sh
pnpm test:unit
pnpm test:snapshot
pnpm docs:check
pnpm security:check
git diff --check
~~~

课程教学文案发生用户可见变化时，必须更新真实组装的 keyless snapshot。新的机械能力还必须加入确定性测试；人工 rubric 和真实模型评估只能补充，不能替代 CI。

当前 0.1.0 只加载一个 manifest，远程课程 Provider、多课程目录和课程作者 CLI 属于后续规格。
