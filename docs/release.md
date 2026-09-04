# Release checks

## Local release candidate

在受支持的 Node 版本和锁定的 DSH 来源 checkout 旁运行：

~~~sh
pnpm check
~~~

其中 `pnpm release:check` 会：

1. 对八个公开 `@learn-dsh/*` package 执行 `pnpm pack`。
2. 检查 runtime dependency、tarball 内容、export 目标和高置信度凭据模式。
3. 在临时 consumer 中从 npm registry 安装精确 DSH `0.1.2-rc.1`，只通过 tarball 安装 Learn DSH packages。
4. 拒绝 DSH 本地链接、workspace protocol、来源 checkout 路径和混合版本。
5. 导入全部公开 package 入口，并验证打包后的 `learn-dsh-setup` bin 与 preset exports。
6. 从安装后的 bundle 路径执行 preset install/check/remove，以及 web profile add、dump、app-owned `--help`、remove、reinstall 和第二次 remove。
7. 在同一个干净 consumer 中运行完整 keyless 教学闭环，并逐字比对受审 snapshot。
8. 清理临时 consumer、profile 和打包产物。

`pnpm security:check` 另外扫描 Git 跟踪文件和未忽略的新文件；`pnpm test:coverage` 生成 `coverage/coverage-summary.json` 与 LCOV 报告，并强制规格声明的总体覆盖率防回退下限。`pnpm eval:teaching:keyless` 对真实组装 snapshot 执行结构化教学 rubric。CI 在 Ubuntu 24.04 的最低/最新 Node 和 macOS 最低 Node 上运行同一聚合门禁；Linux job 从 Ubuntu 官方包安装 bubblewrap、AppArmor profile 和 profile loader，在保持全局 user-namespace 限制启用的前提下加载 `bwrap-userns-restrict`，并先执行 DSH 同形 bwrap probe，不降低 `workspace-write` sandbox。

## Registry publication boundary

DSH `0.1.2-rc.1` 的完整 package closure 已发布，registry-only 本地发布候选门禁已通过。以下条件全部满足前，仍不执行 `npm publish` 或创建 0.1.0 release：

- 新基线的 Linux Node 22.19/24 与 macOS Node 22.19 CI matrix 通过。
- 人工教学 rubric 已执行，且没有高严重度问题。
- 新用户十分钟启动计时演练已完成。
- acceptance evidence 指向同一发布 commit 和通过的 CI run。

发布属于外部状态变更，需要明确发布授权。package 版本、tag、release notes 和升级/迁移说明必须在授权时一起确认。
