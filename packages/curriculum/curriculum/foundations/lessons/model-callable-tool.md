# System Prompt、Tool Schema、Agent Loop 与 Session Log

模型可调用 Tool 由插件注册到 `ctx.tools`。`defineTool` 把参数与输出规范转换成模型可见 schema，并在 execute 前执行验证。Agent Loop 把 schema 放入请求，接收 tool call，通过 guarded ToolRuntime 执行，再把规范结果和渲染内容作为 Session 事件持久化。

System Prompt 告诉模型何时使用能力，Tool Schema 定义可调用边界，Agent Loop 驱动请求与执行，Session Log 保存模型实际看到的输入和工具结果；四者不能互相替代。

练习要求实现一个 `greet` Tool：必填字符串参数、结构化输出、独立纯函数和 Cordis 注册入口都必须可被确定性检查观察。
