# Capability Seam：Service Definition、Provider 与 Consumer

Capability seam 是一个完整可替换能力，由三种角色组成：Service Definition 声明稳定接口，Service Provider 实现该接口，Consumer 只依赖 Definition。普通类型边界或单个 Provider 不能单独称为 seam。

本单元以 DSH subprocess 为真实来源：`SubprocessRuntime` 是 Definition，`LocalSubprocessRuntime` 是本地 Provider，Shell 等 Consumer 通过 `ctx.subprocess` 使用能力。替换 Provider 不应要求修改 Consumer。

练习要求实现最小 Clock Definition 和 LocalClock Provider，并明确 service name、Context augmentation、实现方法和卸载生命周期。
