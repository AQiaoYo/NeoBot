"""创建可运行工程，显式导入作者代码导出公开契约。"""

from __future__ import annotations

import contextlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

from neobot_modloader.loader import FilesystemPluginLoader, LoadedPlugin, PluginLoadError
from neobot_modloader.loading.manifest import read_manifest
from neobot_modloader.plugins.registration import validate_plugin_name

from .models import ToolingError, ToolReport
from .validation import contract_path, read_contract

_PLUGIN = '''from pydantic import BaseModel, Field
from neobot_modloader import Plugin, Reply


class Config(BaseModel):
    """插件的可配置回复内容。"""

    greeting: str = Field(default="pong", title="回复内容", description="/ping 的回复文字")


plugin = Plugin({name!r}, version="0.1.0", config=Config)


@plugin.command("ping")
async def ping(reply: Reply, config: Config) -> None:
    await reply.send(config.greeting)


plugin.surface.guide(
    "first-use",
    title="首次使用",
    steps=[
        {{
            "target": "config.greeting",
            "text": "在插件配置中填写回复内容，再保存配置。",
            "chapter": "设置回复",
            "example": {{"greeting": "你好，NeoBot"}},
        }},
        {{
            "target": "config.greeting",
            "text": "回到与机器人的私聊，发送 /ping。机器人会回复刚才保存的文字。",
            "chapter": "发送命令验证",
            "command": {{"text": "/ping", "context": "在与机器人的私聊中发送", "reply": "你好，NeoBot"}},
        }},
    ],
    demo={{"config": {{"greeting": "你好，NeoBot"}}}},
)
'''

_TEST = """from pathlib import Path
from neobot_modloader.context import RuntimePluginContext
from neobot_modloader.hooks import PluginHookBus
from neobot_modloader.loader import FilesystemPluginLoader


class Adapter:
    def __init__(self):
        self.messages = []

    async def send(self, conversation, message):
        self.messages.append(message)
        return "test-message"


class Event:
    raw_event = {{"post_type": "message", "message_type": "private", "user_id": 10001, "raw_message": "/ping"}}
    consumed = False
    skip_ai_reply = False

    def consume(self):
        self.consumed = True

    def block_ai_reply(self):
        self.skip_ai_reply = True


async def test_configured_ping_reply(tmp_path):
    loader = FilesystemPluginLoader()
    loaded = loader.load_one(Path(__file__).resolve().parents[1])
    assert loaded is not None and loaded.plugin is not None
    adapter = Adapter()
    hooks = PluginHookBus()
    context = RuntimePluginContext(
        plugin_name={name!r}, plugin_dir=loaded.plugin_dir, data_dir=tmp_path,
        config={{"greeting": "custom reply"}}, logger=None, adapter=adapter, hook_bus=hooks,
    )
    try:
        await loaded.plugin.on_load(context)
        await loaded.plugin.on_start()
        await hooks.dispatch(Event())
        assert adapter.messages == ["custom reply"]
        assert loaded.plugin.surface.describe(loaded.plugin)["actions"] == []
    finally:
        await loaded.plugin.on_stop()
        loader.clear_module_cache(loaded.module_names)
"""

_README = """# {name}

这个工程包含可配置的 `/ping` 命令、思索说明书和真实消息分发测试。

1. 在 `__init__.py` 的 `Config` 中声明配置名称、默认值和约束，宿主自动生成表单。
2. 修改 `ping` 或添加业务处理，测试用户保存的配置是否真正生效。
3. 修改 `plugin.guide(...)` 的说明和合成样例，目标引用使用 `config.<字段名>`。
4. 在已同步 NeoBot 依赖的开发环境中重新导出契约并执行工程验收。

```powershell
python -m neobot_modloader.sdk export .
python -m neobot_modloader.sdk check .
python -m neobot_modloader.sdk export . --check
```

完整验收入口是 NeoBot 仓库的 `scripts/plugin_ci.py`，传入当前工程目录和一个新的报告目录即可。普通配置不需要 HTML、JavaScript 或 Node；只有特殊交互才增加自定义页面。

`plugin.contract.json` 由工具生成。用户配置和业务数据保存在宿主的数据目录，插件源码、默认值与测试中不要放入真实凭据。
"""


def export_contract(path: Path, *, check: bool = False) -> ToolReport:
    """此操作会执行插件入口，必须在可信开发环境或隔离 CI 中运行。"""
    root = Path(path).resolve()
    loader = FilesystemPluginLoader(namespace="neobot_sdk_export", enabled_resolver=lambda _name, _default: True)
    loaded = None
    try:
        metadata = read_manifest(root / "plugin.toml")
        target = contract_path(root, metadata, must_exist=False)
        with contextlib.redirect_stdout(sys.stderr):
            loaded = loader.load_one(root)
            if isinstance(loaded, PluginLoadError):
                raise ToolingError(f"插件导入失败: {loaded.error}")
            if not isinstance(loaded, LoadedPlugin):
                raise ToolingError("插件导入失败: 没有可加载入口")
            document = loaded.plugin.surface.describe(loaded.plugin)
        from neobot_modloader.sdk.contract import validate_contract

        errors = validate_contract(document)
        if errors:
            return ToolReport("export", False, errors=tuple(errors), path=str(target), executes_plugin=True)
        if check:
            if not target.is_file() or read_contract(target) != document:
                raise ToolingError("静态契约已过期，请重新执行 export 并检查差异")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            content = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
            target.write_text(content, encoding="utf-8", newline="\n")
        return ToolReport("export", True, ("contract",), path=str(target), executes_plugin=True)
    except SystemExit as exc:
        return ToolReport(
            "export", False, errors=(f"插件入口请求退出: {exc.code!r}",), path=str(root), executes_plugin=True
        )
    except Exception as exc:
        return ToolReport("export", False, errors=(str(exc),), path=str(root), executes_plugin=True)
    finally:
        if isinstance(loaded, LoadedPlugin):
            loader.clear_module_cache(loaded.module_names)


def init_project(path: Path, name: str, *, template: Path | None = None) -> ToolReport:
    """先在暂存目录生成和导出，目标已存在时保持原样。"""
    destination = Path(path).absolute()
    try:
        validate_plugin_name(name)
        if destination.exists() or destination.is_symlink():
            raise ToolingError("目标已存在，请选择一个新的插件目录")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Windows 读取句柄可能暂时阻止删除私有暂存文件，不影响已验证目标的创建结果。
        with tempfile.TemporaryDirectory(
            prefix=".neobot-init-", dir=destination.parent, ignore_cleanup_errors=True
        ) as temporary:
            staging = Path(temporary) / name
            staging.mkdir()
            if template is not None:
                from .templates import instantiate_template

                instantiate_template(template, staging, name)
            else:
                _write_minimal_template(staging, name)
            report = export_contract(staging)
            if not report.ok:
                raise ToolingError("; ".join(report.errors))
            if template is not None:
                from .validation import check_project

                checked = check_project(staging)
                if not checked.ok:
                    raise ToolingError("; ".join(checked.errors))
            destination.mkdir()
            try:
                shutil.copytree(staging, destination, dirs_exist_ok=True)
            except BaseException:
                shutil.rmtree(destination)
                raise
        return ToolReport("init", True, ("template", "contract"), path=str(destination))
    except (OSError, ValueError) as exc:
        return ToolReport("init", False, errors=(str(exc),), path=str(destination))


def _write_minimal_template(staging: Path, name: str) -> None:
    """离线创建与独立仓库相同形状的唯一入门工程。"""
    (staging / "plugin.toml").write_text(
        f'name = "{name}"\nversion = "0.1.0"\npython_dependencies = ["pydantic>=2,<3"]\n'
        '[sdk]\nversion = 1\ncontract = "plugin.contract.json"\n',
        encoding="utf-8",
    )
    (staging / "__init__.py").write_text(_PLUGIN.format(name=name), encoding="utf-8")
    (staging / "README.md").write_text(_README.format(name=name), encoding="utf-8")
    (staging / "tests").mkdir()
    (staging / "tests" / "test_plugin.py").write_text(_TEST.format(name=name), encoding="utf-8")
    (staging / "pyproject.toml").write_text('[tool.pytest.ini_options]\nasyncio_mode = "auto"\n', encoding="utf-8")
