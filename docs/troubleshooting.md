# Troubleshooting

## Node 版本不受支持

症状：`pnpm compat` 报告当前 Node 不满足 `^22.19.0 || >=24.0.0`。

处理：切换到 Node 22.19 以上的 22.x，或 Node 24 以上版本，再重新运行 `pnpm install --frozen-lockfile`。不要忽略该错误，因为 DSH 与 Learn DSH 使用同一版本边界。

## 找不到 DSH 来源 checkout 或 commit 不匹配

运行时 DSH 从 npm registry 安装；来源 checkout 只用于课程文档、源码入口和 anchor 验证。默认布局要求 `deepseek-harness` 与 `learn-deepseek-harness` 相邻，非相邻布局可显式指定：

~~~sh
DSH_CHECKOUT=/absolute/path/to/deepseek-harness pnpm compat
~~~

checkout 必须位于 commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`。不需要在 DSH 仓库安装依赖或构建 `lib`；若 `pnpm compat` 报告 registry 版本错误，应在 Learn DSH 仓库重新运行 `pnpm install --frozen-lockfile`。

## profile 安装失败

先运行 `pnpm build`，再运行 `pnpm test:profile`。该测试使用临时 `DSH_HOME`，不会修改真实 profile，并覆盖 preset install/check/remove、web profile add、dump-config、app-owned `--help`、remove、reinstall 和第二次 remove。

如果手动 profile 缺少 Agent、System Prompt、Tools、Session、agent-preset roster 或 sandboxed FS/Shell 基础能力，bundle 行可以出现，但不能形成完整教学 Runtime。交互使用应安装到 `web` profile，并先运行 `pnpm preset:install`。当前完整 keyless 证据入口是 `pnpm example:headless`。

若 setup 报告 preset directory not owned，说明 `$DSH_HOME/.agent-presets/learn-dsh` 已存在但没有 Learn DSH marker；命令不会覆盖它。请先检查并手动迁移该目录。若 remove 报告 unowned files，先移走额外文件，避免卸载误删用户内容。

## 课程或来源加载失败

- duplicate、missing prerequisite 或 cycle：修复课程 ID 与图关系。
- source path 或 anchor missing：确认 DSH checkout commit、路径和稳定 anchor。
- unsafe path：课程正文、source、fixture 或 check entry 不能使用绝对路径、`..` 或符号链接逃逸。
- unsupported DSH version：课程和 Runtime 必须同时匹配兼容矩阵。

## learner-memory 无法恢复

本地 Provider 会明确报告 malformed JSON、torn record、identity mismatch、sequence gap、duplicate identity 和 unsupported version。不要删除或跳过损坏记录后继续声称状态完整；先保留原文件用于诊断，再选择离线迁移或新的 Enrollment。

payload version 1 不会自动迁移到当前 version 2。本地 Provider 只支持单 host 进程写同一存储根，不能让多个进程并发共享。

## 练习被 blocked

`configuration`、`environment` 或 `safety` 类结果表示当前尝试被阻塞，不代表学习者能力失败。修复环境后应在同一 attempt 重试。不要绕过 DSH FS、Shell、Sandbox 或 Approval 直接执行检查。

## 发布候选检查失败

运行 `pnpm release:check` 查看具体包。该门禁会拒绝 tarball 中的 source、tests、coverage、Session、attempt、learner-memory 数据、环境文件、凭据模式、缺失 export，以及 runtime dependency 中残留的 `workspace:` 或 `link:`。

该门禁必须从 npm registry 安装唯一的 DSH `0.1.2-rc.1` package closure，并只从临时 tarball 安装 Learn DSH。来源 checkout 只允许用于课程 anchor；任何运行时本地链接、checkout 路径或混合 DSH 版本都会失败。
