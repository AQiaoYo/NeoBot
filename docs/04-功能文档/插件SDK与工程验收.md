# 插件 SDK 与工程验收

NeoBot 插件 SDK 提供配置、动作、资源和说明书声明，并配套工程检查、契约导出、测试、打包和升级工具。常用业务设置由面板统一渲染；需要特殊交互时可声明自定义页面。普通 Python 插件不需要 Node。

## 创建并检查第一个工程

在 NeoBot 仓库根目录，使用已同步依赖的开发环境：

```powershell
uv run python -m neobot_modloader.sdk init tmp/hello_plugin --name hello_plugin
uv run python -m neobot_modloader.sdk check tmp/hello_plugin
uv run python -m neobot_modloader.sdk export tmp/hello_plugin --check
uv run python scripts/plugin_ci.py tmp/hello_plugin --output-dir tmp/hello_plugin_acceptance
```

`init` 要求目标目录不存在。生成的入口包含 `/ping`、可配置的回复文字、对应配置和聊天命令的使用说明，以及命令回复测试。更改声明后执行 `export`，再检查生成的契约差异。

静态检查先校验 Schema 遍历需要的对象、列表和正则表达式，再检查公开默认值与教程引用。声明写错时，`check --json` 返回带字段位置的失败报告，不执行插件入口，也不把默认值写进错误信息。

配置、动作和业务存储按需添加到同一工程；普通配置由宿主统一渲染，只有特殊交互才增加自定义页面。有独立前端工程时再引入 pnpm。需要使用本地模板时，可通过 `init --template <目录>` 指定模板目录。

| 文件 | 用途 | 作者需要维护的内容 |
| --- | --- | --- |
| `plugin.toml` | 插件身份、依赖和 SDK 声明 | 名称、版本、Python 依赖和可选前端 |
| `__init__.py` | 插件入口 | 配置模型、业务函数、资源和教程引用 |
| `plugin.contract.json` | 可公开的静态契约 | 通过 `export` 生成，修改后检查差异 |
| `tests/` | 离线业务测试 | 真实业务断言，外部服务使用合成数据 |
| `pyproject.toml` | 工程工具配置 | 模板已配置异步 pytest |

用户配置保存在宿主的 `plugins_data/<name>/config.toml`，不写进插件代码目录。包内默认值与用户保存值由宿主合并，重载与回滚按实际插件代恢复。

## SDK 契约与说明书素材

`Plugin` 提供 `action/resource/settings/guide/view`，也可通过 `plugin.surface` 访问同一入口。动作处理器接收校验后的输入与 `ActionInvocation`；同步和异步函数均可。可明确向使用者公开的业务失败使用 `ActionError`；未知异常仍只返回固定错误，不公开输入或异常正文。

| 参数 | 约束 | 契约用途 |
| --- | --- | --- |
| `id` | 小写稳定 ID，允许数字、点、横线、下划线，不能含空点段 | HTTP 和教程使用这个 ID |
| `input_model` | 提供 Pydantic 模型协议；省略时接收对象参数 | 描述参数结构，供校验和样例舞台使用 |
| `output_model` | 可选，校验后按序列化别名返回 JSON | 返回字段与输出 Schema 使用同一套名称 |
| `title/description` | 面向使用者的中文标题和解释 | 用于说明书样例标题 |
| `permission` | `read/operate/manage`，默认 `manage` | 服务端再次检查，页面仅据此禁用控件 |

输入 Schema 使用模型的 validation 模式，输出使用 serialization 模式。`RootModel` 的数组、数字、布尔、字符串和 null 保留原类型。模型校验失败返回字段位置与错误类型，不回显输入或处理器异常正文。SDK 接口继续保留既有验证规则，说明书不调用真实动作。

`ActionInvocation` 由可信入口构造，包含调用身份、权限集合和当前插件上下文。HTTP 请求中的 `identity/permissions/context` 不能替代它。动作调用与插件停止、卸载和重载共用插件操作锁，防止业务运行到一半被切换成另一代。

| 权限 | 使用场景 | 当前面板提供条件 |
| --- | --- | --- |
| `read` | 列表、查询、教程状态检查 | 已登录会话 |
| `operate` | 作者明确允许普通会话执行的业务操作 | 已登录会话；POST 仍需要 CSRF |
| `manage` | 新增、删除、管理性修改 | 已登录且满足面板管理开关与来源策略 |

## 把说明书接入面板

既有资源声明使用 `list_action` 和 `columns`，其动作引用规则继续保留；说明书只使用声明和明确提供的样例，不为这些资源生成真实列表或增删入口。

常见业务通过作者明确声明的 `settings` 接入：插件管理 → 当前插件 → 配置表单 → 设置分组。字段来自动作输入模型，动态选择、预览、提交、列表和行开关由宿主统一渲染。分组默认常驻，低频内容可声明收起；输入、权限、忙碌、过期回包和演示暂停由宿主管理。特殊交互仍可声明 `view`，引用宿主 `_ui.css` 复用布局和主题。两种入口都共用正文滚动、原编辑器操作锁和权限，见 [插件设置界面](插件设置界面.md)。

教程步骤引用稳定目标：

| 目标 | 示例 | 效果 |
| --- | --- | --- |
| 配置字段 | `config.greeting` | 解析实际字段 Schema，复用配置控件展示只读样例及真实位置 |
| 动作 | `action.status` | 展示动作声明及合成样例 |
| 资源 | `resource.subscriptions` | 说明资源用途及示例内容 |
| 自定义页面锚点 | `view.subscriptions.preview` | 在演示舞台定位样例页面元素 |
| 宿主设置控件 | `settings.subscriptions.group_id` | 复用真实设置组件展示字段、动作和列表 |

动作和资源 ID 可以含点号；页面 ID 和锚点 ID 不含点号，`view.<页面>.<锚点>` 由三部分组成。删除字段、动作或页面锚点后未更新教程会在导出、静态检查或运行时契约读取中报错。

为兼容现有声明，`completion_action` 仍要求引用 `read` 动作，但说明书不执行它，也不显示业务完成检查。看完说明仅表示阅读结束。插件停止或禁用时仍可读取包内静态教程，读取静态契约不会执行插件入口。

在面板的“插件”页选择插件后，点击“使用说明”直接进入思索说明书。没有声明说明书的插件隐藏该入口。原有配置表单、TOML 编辑和未保存草稿继续使用原流程。

说明书只有章节、演示舞台、字幕和播放控件；多篇说明可以切换篇目。真实操作留在原配置表单，不增加通用操作页签、跟做工具条或完成检查。

## 思索说明书

思索进入覆盖整个应用的教程舞台，顶部提供说明选择与“返回配置”，画面下方集中分章时间线、播放控制和字幕。点击章节段切章，点击当前章的落点回看步骤；键盘左右键回看、方括号切章、空格播放或暂停、Esc 返回。重播从当前章开始，暂停和隐藏页面保留剩余播放时间；减少动态效果时默认手动切换。业务动作、权限与持久化由 NeoBot 宿主负责。

教程作者仍然声明 `target/text`，可增加 `chapter` 和有限 JSON `example`。聊天步骤增加 `command={text, context, reply?}`，展示可复制的真实命令和使用场景，可选回复必须明确是样例。该元数据不注册或执行命令；静态检查验证结构和目标引用，作者业务回归还必须验证命令可达性。`guide.demo` 明确提供演示动作结果和配置：

```python
plugin.guide(
    "first",
    title="添加第一条记录",
    steps=[{"chapter": "开始使用", "target": "view.tasks.new", "text": "填入一项待办。", "example": {"title": "演示待办"}}],
    demo={"actions": {"items.list": {"items": []}}, "config": {"caption": "演示清单"}},
)
```

思索只读取这些合成结果，宿主不代发真实动作，也不保存真实配置；缺少样例的动作明确失败。打开和关闭说明书不会替换原配置节点或修改原草稿。

入口直接打开整屏思索。键盘可操作播放、暂停和章节；长字幕可滚动，低高度窗口提供内容滚动退路。相同章节的后台刷新不重置播放计时。

`streaming_parser` 提供“开始监听”“群聊命令”“面板设置”三篇说明。第一篇对应配置表单内真实“直播订阅”的选群、识别、预览、开始监听与状态；第二篇说明群聊的 @、权限和真实命令；第三篇覆盖全部全局字段，解释群覆盖、已有订阅和重启生效。思索画面使用样例，不读取或创建真实订阅；必须退出说明书后在真实设置中操作。

## 导出可公开的契约

清单启用版本 1 契约：

```toml
[sdk]
version = 1
contract = "plugin.contract.json"
```

契约只描述类型、字段、动作、页面和教程。导出不会实例化模型或执行默认工厂；`writeOnly/sensitive/x-neobot.secret` 和认证字段名标记的默认值不会公开，父对象、字典与元组的嵌套默认值也会按声明处理。真实凭据不要放进代码、清单或测试样例。

配置接口与桥接遵守同样的只写语义，含敏感值时不返回 TOML 源码。占位符和留空保留原值，在模型校验前恢复；`SecretStr/SecretBytes` 保存真实文本，不把显示掩码写入文件。配置校验失败只公开字段位置与固定消息，避免作者校验器将存量凭据回传页面。

`export` 会导入作者代码；`check` 与 `build` 只读取静态文件。`export --check` 只比较，不改写契约，避免 CI 悄悄替作者更新过期文件。

## 可选前端工程

标准配置与业务分组不需要前端工程。需要特殊交互时，可显式声明构建目录与包内入口；这些页面用于真实设置，也可作为思索的隔离样例素材：

```toml
[sdk]
version = 1
contract = "plugin.contract.json"
pages = ["web/index.html"]

[sdk.frontend]
path = "frontend"
```

`frontend/package.json` 必须把 `packageManager` 锁定为精确的 `pnpm@x.y.z`，提供 `verify/build`，并携带 `pnpm-lock.yaml`。验收先冻结安装依赖、验证和构建，再检查页面入口。声明的页面构建树会进入最终 ZIP，`node_modules`、虚拟环境、缓存和未声明构建目录不分发。

同时注册页面与稳定锚点：

```python
plugin.view("tasks", title="待办清单", entry="web/tasks/index.html", anchors=["new", "list"])
```

页面以入口所在目录为分发边界；私有文件、Python、TOML、隐藏路径和逃逸符号链接不公开。宿主与工具共用资源解析规则，静态检查会验证明确的相对资源引用。页面文件为公开分发内容，不应放凭据或真实用户数据。

特殊页面引用相对 `_sdk.js` 后使用 `window.NeoBotPlugin`；可按需引用宿主 `frontend/public/assets/plugin-view-sdk.d.ts` 的同版本类型声明，普通 Python 模板不需要前端文件：

| 方法 | 行为 |
| --- | --- |
| `ready()` / `onContext()` | 当前插件、权限、可用状态、主题 token、语言与动态效果偏好 |
| `action(id, values)` | 宿主验证当前页面会话和插件，再走原动作鉴权、输入校验与操作锁 |
| `getConfig()` / `saveConfig(values, revision)` | 复用原配置接口；revision 是不透明字符串，新文件为空串；冲突返回 409 |
| `notify()` / `navigate()` | 统一通知与宿主内的受限定位 |
| `registerAnchor()` / `onGuideStep()` | 登记可定位元素、接收当前步骤与合成样例，注销函数用于清理 |

锚点可以贴着页面边缘或位于局部滚动容器中。SDK 自动报告可见范围，宿主将思索高亮与指针保持在舞台内；滚动或调整尺寸后自动更新，目标完全不可见时隐藏高亮。开发者无需为描边增加空白占位，也不要另加向外扩展的高亮 outline。页面控件使用 `_ui.css` 时，键盘焦点描边同样保持在控件内侧。

内联设置页通过 Tab 等操作聚焦控件时，SDK 会配合宿主滚动正文，使控件完整显示；固定的标题、工具栏和保存区保持不动。开发者不需要自行操作宿主滚动位置。暂停、思索演示或焦点已经离开该页面时，不触发此滚动。

说明书加载、演示结束和错误统一通过全局 InfoBar 反馈，不在布局内追加通知条。演示页面始终以 demo 模式使用明确样例，真实配置的 get/save 和真实动作不由说明书入口调用。

唯一 InfoBar 宿主通过 Portal 挂在 body，避免被应用固定容器的堆叠上下文困住。通知的关闭与详情操作不视作业务弹窗的外部关闭；真实浏览器回归同时检查通知的命中点和交互，不能只凭 DOM 可见性判定未被遮挡。

iframe 使用 `sandbox="allow-scripts allow-forms"`，允许页面用 JS 处理标准表单事件；CSP 的 `form-action 'none'` 仍阻止所有网络表单外发。响应本身也带 CSP sandbox，直接打开页面仍是空源。只有公开静态文件开放无凭据 CORS，支持 ES module、动态 import 和字体；不向页面开放面板 Cookie、token、CSRF 或任意 HTTP 代理。桥接绑定 window、当前页面与随机会话；重载或切换插件后旧页面不能继续调用。保存配置与动作共用入口锁，演示中的配置保存明确拒绝。

## 本地和 CI 执行同一套检查

完整入口是 [`scripts/plugin_ci.py`](../../scripts/plugin_ci.py)。报告保存在 `--output-dir`，该目录必须位于插件工程外。

| 顺序 | 检查内容 | 失败条件 |
| --- | --- | --- |
| 1 | 静态工程声明 | 入口、身份、依赖、契约或前端声明无效 |
| 2 | 安装清单的 Python 依赖并检查环境 | 安装失败、依赖不一致 |
| 3 | 可选前端 | 锁文件、验证或构建失败 |
| 4 | 静态契约与显式导出比较 | 页面缺失、引用失效、敏感默认值、契约过期 |
| 5 | 作者业务 pytest | 零用例、失败、错误、skip、xfail、xpass 或 deselected；通过数按父测试项统计，子测试中的失败或跳过也会阻断 |
| 6 | 两次确定性构建 | 两份 ZIP 的 SHA256 不相同 |
| 7 | 最终 ZIP 安装冒烟 | 真实安装、启停、重启、重载或配置位置检查失败 |

输出包括 `report.json`、`pytest.xml`、阶段日志、`plugin.zip` 和 `SHA256SUMS`。安装冒烟使用与构建报告相同摘要的 ZIP，在临时插件与数据目录运行真实安装器和运行时，模拟出站服务并清理任务与模块缓存。

作者业务 suite 默认是 `tests/`。含历史网络测试的工程可以显式声明 `[sdk.tests] path = "tests/acceptance"`；报告写出实际验收范围，所选 suite 必须有真实业务断言且零跳过。历史测试继续独立运行，不通过删测试或标记跳过换取验收通过。

所有会执行作者代码的步骤都应在可信开发环境或无凭据 CI 中执行。模拟适配器不是进程或网络沙箱。报告保留真实服务、数据库迁移等未验收项，作者测试也只证明所写的业务断言。

可复用工作流是 [`plugin-ci.yml`](../../.github/workflows/plugin-ci.yml)，调用方需要传入包含本实现的完整 40 位 SDK 提交，以及插件相对路径。SDK 仓库固定为 `SuperQuail/NeoBot`；不接受浮动分支。默认矩阵为 Windows/Linux、Python 3.13/3.14。纯 Python 插件不会安装 Node。

宿主的新增 [`plugin-sdk-validation.yml`](../../.github/workflows/plugin-sdk-validation.yml) 分别检查生成模板、SDK 回归和最终包的真实浏览器流程。工作流只有读取权限，不负责签名、入库或发布；必需任务失败、取消或跳过不能形成整体通过。

## 维护期升级与恢复

需要迁移存储的插件显式声明 `[sdk.storage] config_version/data_version` 和连续的 `[[sdk.migrations]]`，分别升级配置与业务数据。版本变化时在线安装器拒绝直接替换，提示先退出宿主，再运行维护工具：

```powershell
uv run python -m neobot_modloader.sdk upgrade plugin.zip --name my_board --plugin-dir ./plugins --data-dir ./plugins_data --json
```

工具需要取得操作系统数据租约，不能用一个 `offline=true` 参数假装宿主已经停止。迁移先在备份副本执行，再切换代码与数据，按实际宿主版本检查兼容性并验证启动。迁移失败不改现有目录；候选启动写入后失败也恢复旧代码、配置与 SQLite 数据。运行时所有插件卸载后释放租约，进程退出也会释放。

这是停止宿主后的维护流程。成功提交并开始处理实际业务后，不自动用旧备份覆盖新业务数据，也没有宣称支持无停机迁移。备份位置、恢复情况和未验证范围写入报告。

## 元信息与受控入库

独立元信息仓库的正式条目要求固定源码提交、HTTPS 最终包地址和 SHA256，以及插件、SDK API、存储和环境兼容范围。商店身份可以使用 `publisher/name`，机器名继续用于插件数据目录和依赖，不混为一谈。

本地候选使用实际 ZIP 摘要和源码树摘要，状态标记为 `local`。受控验收重新执行作者 suite、契约与构建，核对重建摘要，并再次安装最初输入的 ZIP；作者自报 `report.ok` 不能作为唯一放行依据。

如果本地已有模板和元信息仓库，可从 NeoBot 仓库运行完整的生态验收：

```powershell
uv run python scripts/plugin_ecosystem.py --template ../NeoBot-Plugin-Template --registry ../NeoBot-Plugin-Registry --output tmp/new-ecosystem-acceptance
```

输出目录需要不存在。报告记录兼容复验、历史版本升级以及迁移失败和启动失败时的恢复结果。工作流使用 SDK 的完整 40 位提交标识。

## 打开本地演示

```powershell
uv run --frozen python scripts/plugin_demo.py --port 19981
```

脚本每次建立全新的临时数据目录，将直播订阅插件打包并安装，再启动实际运行时、SQLite、轮询和面板。打开终端输出的本地地址，使用终端显示的演示密码登录。选择插件后，可在配置页操作或点击“使用说明”查看演示。需要加载其他本地插件时，可添加 `--sample <插件目录>`。

群、直播响应和图片传输使用合成数据；平台响应解析、订阅服务、模板预览、数据库和面板实际运行。演示不读取用户真实配置，不连接真实 QQ 或付费模型，不能代替外部平台联调。

## 使用消息链

OneBot 发送入口统一调用现有消息归一化规则，`Bot/PluginContext/Reply` 对 `MessageChain`、单段、段数组和文本使用相同载荷。适配器返回结果与异常仍按原接口传递。

`MessageChain` 支持 `get/has/first/include/exclude/copy`、迭代、下标与切片；查询条件可用段类型名称或 `MessageSegment` 子类。`copy` 和 `Message.to_chain` 提供独立快照，未知消息段保留原始类型及数据。

## 验证边界

本地合成数据和插件工程验收不能代替真实 QQ、直播平台、网络环境或目标操作系统的联调。插件发布前应在实际运行环境中验证连接、权限、更新和迁移恢复。
