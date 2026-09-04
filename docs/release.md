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
5. 验证打包后的 `learn-dsh-setup` bin 与 preset exports。
6. 从安装后的 bundle 路径执行 preset install/check/remove，以及 web profile add、dump、app-owned `--help`、remove、reinstall 和第二次 remove。
7. 清理临时 consumer、profile 和打包产物。

`pnpm security:check` 另外扫描 Git 跟踪文件和未忽略的新文件；`pnpm test:coverage` 生成 `coverage/coverage-summary.json` 与 LCOV 报告，并强制规格声明的总体覆盖率防回退下限。`pnpm eval:teaching:keyless` 对真实组装 snapshot 执行结构化教学 rubric。CI 在 Ubuntu 24.04 的最低/最新 Node 和 macOS 最低 Node 上运行同一聚合门禁；Linux job 从 Ubuntu 官方包安装 bubblewrap、AppArmor profile 和 profile loader，在保持全局 user-namespace 限制启用的前提下加载 `bwrap-userns-restrict`，并先执行 DSH 同形 bwrap probe，不降低 `workspace-write` sandbox。

## Registry publication boundary

当前支持的 DSH `0.1.0-rc.5` 没有完整 npm 包集，Learn DSH 开发依赖仍从锁定的相邻 checkout 解析。以下条件全部满足前，不执行 `npm publish` 或创建 0.1.0 release：

- 受测 DSH package closure 已以相同版本发布，或规格与兼容矩阵先批准新的 DSH 基线。
- 纯 registry 临时环境能够安装 bundle、启动教学 Runtime、卸载并重装。
- 人工教学 rubric 已执行，且没有高严重度问题。
- acceptance evidence 指向同一发布 commit 和通过的 CI run。

发布属于外部状态变更，需要明确发布授权。package 版本、tag、release notes 和升级/迁移说明必须在授权时一起确认。
