"""插件页面、思索章节与合成演示声明的公共契约回归。"""

import pytest

from neobot_modloader import Plugin
from neobot_modloader.sdk.contract import validate_contract


def sample_plugin():
    plugin = Plugin("guide_demo")

    @plugin.action("items.list", permission="read")
    def items(values, caller):
        return []

    return plugin


def test_view_and_guide_export_declared_anchors_chapters_and_isolated_examples():
    plugin = sample_plugin()
    examples = {"actions": {"items.list": [{"title": "演示条目"}]}}
    step = {"target": "view.items.add", "text": "添加条目", "chapter": "首次使用", "example": {"title": "示例"}}
    plugin.view("items", title="条目管理", entry="web/items/index.html", anchors=["add", "list"])
    plugin.guide("start", title="添加第一个条目", steps=[step], demo=examples)
    examples["actions"]["items.list"].clear()
    step["example"]["title"] = "已修改"
    contract = plugin.surface.describe(plugin)
    assert contract["views"] == [
        {
            "id": "items",
            "title": "条目管理",
            "entry": "web/items/index.html",
            "anchors": ["add", "list"],
        }
    ]
    assert contract["guides"][0]["steps"][0]["example"] == {"title": "示例"}
    assert contract["guides"][0]["demo"]["actions"]["items.list"] == [{"title": "演示条目"}]
    assert validate_contract(contract) == []
    contract["views"][0]["anchors"].clear()
    contract["guides"][0]["demo"]["actions"].clear()
    assert plugin.surface.describe(plugin)["views"][0]["anchors"] == ["add", "list"]
    assert "items.list" in plugin.surface.describe(plugin)["guides"][0]["demo"]["actions"]


@pytest.mark.parametrize(
    "entry", ["../outside.html", "/web/index.html", "C:/index.html", "web/main.py", "web\\index.html"]
)
def test_view_rejects_unsafe_or_non_html_entry(entry):
    with pytest.raises(ValueError):
        sample_plugin().view("items", title="条目", entry=entry, anchors=[])


def test_view_ids_and_anchor_names_have_unambiguous_target_segments():
    with pytest.raises(ValueError):
        sample_plugin().view("items.extra", title="条目", entry="web/index.html", anchors=[])
    with pytest.raises(ValueError):
        sample_plugin().view("items", title="条目", entry="web/index.html", anchors=["add.extra"])
    with pytest.raises(ValueError):
        sample_plugin().view("items", title="条目", entry="web/index.html", anchors=["add", "add"])


def test_unknown_view_anchor_or_demo_action_is_rejected_in_dynamic_and_static_contract():
    plugin = sample_plugin()
    plugin.view("items", title="条目", entry="web/index.html", anchors=["add"])
    plugin.guide("start", title="开始", steps=[{"target": "view.items.missing", "text": "不存在"}])
    with pytest.raises(ValueError):
        plugin.surface.describe(plugin)
    document = {
        "schema_version": 1,
        "plugin": {"name": "guide_demo", "version": "1.0.0"},
        "config": None,
        "actions": [],
        "resources": [],
        "views": [{"id": "items", "title": "条目", "entry": "web/index.html", "anchors": ["add"]}],
        "guides": [
            {
                "id": "start",
                "title": "开始",
                "steps": [{"target": "view.items.add", "text": "添加"}],
                "demo": {"actions": {"missing": []}},
            }
        ],
    }
    assert any("demo" in error for error in validate_contract(document))
    document["guides"][0].pop("demo")
    document["guides"][0]["steps"][0]["target"] = "view.items.missing"
    assert any("target" in error for error in validate_contract(document))


def test_static_views_require_a_readable_title():
    plugin = sample_plugin()
    plugin.view("items", title="条目", entry="web/index.html", anchors=[])
    contract = plugin.surface.describe(plugin)
    contract["views"][0]["title"] = " "
    assert "views.items.title 不能为空" in validate_contract(contract)


def test_legacy_guide_contract_does_not_gain_empty_optional_fields():
    plugin = sample_plugin()
    plugin.guide("start", title="开始", steps=[{"target": "action.items.list", "text": "查看"}])
    contract = plugin.surface.describe(plugin)
    assert "views" not in contract
    assert contract["guides"] == [
        {
            "id": "start",
            "title": "开始",
            "steps": [{"target": "action.items.list", "text": "查看"}],
            "completion_action": None,
        }
    ]


@pytest.mark.parametrize("reply", [None, "已开始监听演示直播间"])
def test_guide_command_exports_copied_chat_instructions_without_requiring_a_registration(reply):
    plugin = sample_plugin()
    command = {"text": "/监听 610001", "context": "在需要接收通知的群里发送"}
    if reply is not None:
        command["reply"] = reply
    expected = dict(command)
    plugin.guide(
        "start",
        title="开始监听",
        steps=[{"target": "action.items.list", "text": "在聊天里使用命令。", "command": command}],
    )
    command["text"] = "/已修改"

    contract = plugin.surface.describe(plugin)
    exported = contract["guides"][0]["steps"][0]["command"]
    assert exported == expected
    assert validate_contract(contract) == []
    exported["context"] = "外部修改"
    assert plugin.surface.describe(plugin)["guides"][0]["steps"][0]["command"] == expected


@pytest.mark.parametrize(
    "command",
    [
        None,
        [],
        "/监听 610001",
        {},
        {"text": "/监听 610001"},
        {"context": "群聊"},
        {"text": " ", "context": "群聊"},
        {"text": 1, "context": "群聊"},
        {"text": "/监听 610001", "context": False},
        {"text": "/监听 610001", "context": " "},
        {"text": "/监听 610001", "context": "群聊", "reply": None},
        {"text": "/监听 610001", "context": "群聊", "reply": " "},
        {"text": "/监听 610001", "context": "群聊", "reply": []},
        {"text": "/监听 610001", "context": "群聊", "execute": True},
    ],
)
def test_guide_command_rejects_the_same_bad_data_in_declarations_and_static_contracts(command):
    plugin = sample_plugin()
    with pytest.raises(ValueError):
        plugin.guide(
            "invalid",
            title="命令说明",
            steps=[{"target": "action.items.list", "text": "使用命令。", "command": command}],
        )
    plugin.guide("valid", title="开始", steps=[{"target": "action.items.list", "text": "查看"}])
    document = plugin.surface.describe(plugin)
    document["guides"][0]["steps"][0]["command"] = command
    assert any("guides.valid.steps[0].command" in error for error in validate_contract(document))


def test_command_instructions_do_not_make_an_unknown_guide_target_valid():
    plugin = sample_plugin()
    plugin.guide(
        "start",
        title="命令说明",
        steps=[
            {
                "target": "action.missing",
                "text": "使用命令。",
                "command": {"text": "/监听 610001", "context": "群聊"},
            }
        ],
    )
    with pytest.raises(ValueError, match="action.missing"):
        plugin.surface.describe(plugin)


@pytest.mark.parametrize(
    "demo", [{"actions": {"items.list": float("nan")}}, {"actions": ["items.list"]}, {"script": "run()"}]
)
def test_demo_is_finite_declarative_data(demo):
    plugin = sample_plugin()
    with pytest.raises(ValueError):
        plugin.guide("start", title="开始", steps=[{"target": "action.items.list", "text": "查看"}], demo=demo)
