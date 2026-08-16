# Profile、Bundle、Preset 与综合组合

普通 Plugin 拥有一项运行时行为；Bundle 分发一组可继续被上层 patch 的 Cordis 配置行；Profile 选择并堆叠 bundles 与用户 patch；agent Preset 只描述单个 Agent 的作用域组合，不承担进程级 Provider。

DSH 从空配置树开始依次应用 bundle layers、profile patch、home patch 和命令行 overlay。后层按 row id 替换整行配置，因此 bundle 应保持组合职责，业务逻辑继续留在独立插件。

综合练习把前两节的 Clock Provider 与 greet Tool 组合到一个 bundle metadata 和 `cordis.patch.yml` 中，并验证安装入口、两行插件配置及源码职责分离。
