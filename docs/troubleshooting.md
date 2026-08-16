# Troubleshooting

## Node 版本不受支持

症状：`pnpm compat` 报告当前 Node 不满足 `^22.19.0 || >=24.0.0`。

处理：切换到 Node 22.19 以上的 22.x，或 Node 24 以上版本，再重新运行 `pnpm install --frozen-lockfile`。不要忽略该错误，因为 DSH 与 Learn DSH 使用同一版本边界。

## 找不到 DSH checkout 或 commit 不匹配

默认布局要求 `deepseek-harness` 与 `learn-deepseek-harness` 相邻。非相邻布局可显式指定：

~~~sh
DSH_CHECKOUT=/absolute/path/to/deepseek-harness pnpm compat
~~~

checkout 必须位于 commit `0cf6f648c80de1b0572057cd746a20863e39d606`。如果只是源码正确但 `lib` 不存在，在 DSH 仓库运行 `pnpm install --frozen-lockfile && pnpm build:lib:host`。

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

由于受支持的 DSH `0.1.0-rc.5` 包集尚未完整发布，当前 release candidate 使用锁定的相邻 checkout 提供 DSH peer dependencies；这不是纯 registry 安装。
