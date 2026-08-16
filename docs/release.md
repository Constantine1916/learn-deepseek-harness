# Release checks

## Local release candidate

在受支持的 DSH checkout 和 Node 版本上运行：

~~~sh
pnpm check
~~~

其中 `pnpm release:check` 会：

1. 对八个公开 `@learn-dsh/*` package 执行 `pnpm pack`。
2. 检查 runtime dependency、tarball 内容、export 目标和高置信度凭据模式。
3. 在临时 consumer 中只通过 tarball 安装 Learn DSH packages。
4. 导入全部公开 package 入口。
5. 从安装后的 bundle 路径执行 profile add、dump、remove、reinstall 和第二次 remove。
6. 清理临时 consumer、profile 和打包产物。

`pnpm security:check` 另外扫描 Git 跟踪文件和未忽略的新文件；`pnpm test:coverage` 生成 `coverage/coverage-summary.json` 与 LCOV 报告，并执行当前总体覆盖率防回退下限。该下限不替代验收要求的每文件 100% 目标。CI 在 Linux 的最低/最新 Node 和 macOS 最低 Node 上运行同一聚合门禁。

## Registry publication boundary

当前支持的 DSH `0.1.0-rc.5` 没有完整 npm 包集，Learn DSH 开发依赖仍从锁定的相邻 checkout 解析。以下条件全部满足前，不执行 `npm publish` 或创建 0.1.0 release：

- 受测 DSH package closure 已以相同版本发布，或规格与兼容矩阵先批准新的 DSH 基线。
- 纯 registry 临时环境能够安装 bundle、启动教学 Runtime、卸载并重装。
- F-AC-002 覆盖率门禁达到测试计划目标。
- 人工教学 rubric 已执行，且没有高严重度问题。
- acceptance evidence 指向同一发布 commit 和通过的 CI run。

发布属于外部状态变更，需要明确发布授权。package 版本、tag、release notes 和升级/迁移说明必须在授权时一起确认。
