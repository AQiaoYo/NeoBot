"""统一设置引用真实业务契约，声明本身不能扩大动作权限。"""

from copy import deepcopy

from pydantic import BaseModel
import pytest

from neobot_modloader import Plugin
from neobot_modloader.sdk import SurfaceContractError
from neobot_modloader.sdk.contract import validate_contract


class Form(BaseModel):
    group_id: int
    target: str


class Target(BaseModel):
    target: str


class Choice(BaseModel):
    group_id: int
    name: str


class Choices(BaseModel):
    items: list[Choice]


class Preview(BaseModel):
    html: str
    fallback_text: str


class Row(BaseModel):
    group_id: int
    target: str
    enabled: bool


class Rows(BaseModel):
    items: list[Row]


class Key(BaseModel):
    group_id: int
    target: str


def plugin_fixture():
    plugin = Plugin("settings_example", version="1.0.0")
    for id, permission, input_model, output_model in (
        ("groups", "read", None, Choices),
        ("resolve", "read", Target, Target),
        ("preview", "read", Form, Preview),
        ("create", "manage", Form, Row),
        ("list", "read", None, Rows),
        ("edit", "manage", Row, Row),
        ("remove", "manage", Key, None),
    ):
        plugin.action(id, permission=permission, input_model=input_model, output_model=output_model)(
            lambda values, invocation: values
        )
    plugin.resource(
        "rows", title="订阅", list_action="list", columns=["target"], create_action="create", delete_action="remove"
    )
    declaration = {
        "title": "直播订阅",
        "input_action": "create",
        "require_action": "preview",
        "fields": [
            {
                "name": "group_id",
                "control": "select",
                "options": {"action": "groups", "items": "items", "value": "group_id", "label": "name"},
            },
            {"name": "target", "placeholder": "输入直播间地址"},
        ],
        "actions": [{"action": "resolve"}, {"action": "preview", "display": "html"}],
        "resource": "rows",
        "edit_action": "edit",
        "switch_fields": ["enabled"],
    }
    return plugin, declaration


def test_exported_settings_bind_existing_schemas_and_tutorial_targets():
    plugin, declaration = plugin_fixture()
    plugin.settings("subscriptions", **declaration)
    plugin.guide(
        "first",
        title="添加订阅",
        steps=[
            {"target": target, "text": "样例"}
            for target in (
                "settings.subscriptions",
                "settings.subscriptions.target",
                "settings.subscriptions.preview",
                "settings.subscriptions.create",
                "settings.subscriptions.resource",
            )
        ],
    )
    contract = plugin.surface.describe(plugin)
    assert validate_contract(contract) == []
    group = contract["settings"][0]
    assert group["collapsed"] is False
    assert group["actions"][0] == {"action": "resolve", "label": "", "display": "summary"}
    assert group["fields"][1] == {
        "name": "target",
        "placeholder": "输入直播间地址",
        "control": "auto",
        "description": "",
        "options": None,
    }
    declaration["fields"][0]["options"]["action"] = "create"
    group["collapsed"] = True
    assert plugin.surface.describe(plugin)["settings"][0]["collapsed"] is False
    assert plugin.surface.describe(plugin)["settings"][0]["fields"][0]["options"]["action"] == "groups"


def test_ui_hint_fields_do_not_need_to_repeat_the_input_model():
    plugin, _ = plugin_fixture()
    plugin.settings("simple", title="简洁设置", input_action="create")
    plugin.guide("first", title="首次使用", steps=[{"target": "settings.simple.target", "text": "填写目标"}])
    assert validate_contract(plugin.surface.describe(plugin)) == []


@pytest.mark.parametrize(
    "change,location",
    [
        (lambda group: group.update(input_action="preview"), "input_action"),
        (lambda group: group.update(require_action="groups"), "require_action"),
        (lambda group: group["actions"][0].update(action="create"), "actions[0].action"),
        (lambda group: group["actions"][0].update(display="html"), "actions[0].display"),
        (lambda group: group["fields"][0]["options"].update(action="create"), "options.action"),
        (lambda group: group["fields"][0]["options"].update(items="missing"), "options.items"),
        (lambda group: group["fields"][0]["options"].update(value="missing"), "options.value"),
        (lambda group: group["fields"][0].update(name="missing"), "fields[0].name"),
        (lambda group: group.update(resource="missing"), "resource"),
        (lambda group: group.update(edit_action="list"), "edit_action"),
        (lambda group: group.update(switch_fields=["target"]), "switch_fields"),
    ],
)
def test_invalid_settings_references_are_rejected_in_runtime_and_static_contract(change, location):
    plugin, declaration = plugin_fixture()
    plugin.settings("subscriptions", **declaration)
    contract = plugin.surface.describe(plugin)
    change(contract["settings"][0])
    assert any(location in error for error in validate_contract(contract))
    altered = deepcopy(declaration)
    change(altered)
    other, _ = plugin_fixture()
    other.settings("subscriptions", **altered)
    with pytest.raises(SurfaceContractError, match="settings.subscriptions"):
        other.surface.describe(other)


@pytest.mark.parametrize(
    "change",
    [
        lambda group: group.update(collapsed="false"),
        lambda group: group.update(fields="synthetic-private-value"),
        lambda group: group["fields"][0].update(control=[]),
        lambda group: group["fields"][0].update(unknown="synthetic-private-value"),
        lambda group: group["fields"][0]["options"].update(items=[]),
        lambda group: group["actions"][0].update(display={}),
        lambda group: group.update(switch_fields=[{}]),
        lambda group: group.update(script="synthetic-private-value"),
    ],
)
def test_malformed_settings_return_diagnostics_without_executing_or_echoing_author_values(change):
    plugin, declaration = plugin_fixture()
    plugin.settings("subscriptions", **declaration)
    contract = plugin.surface.describe(plugin)
    change(contract["settings"][0])
    errors = validate_contract(contract)
    assert errors
    assert "synthetic-private-value" not in str(errors)


def test_required_secondary_input_must_be_bindable_from_group():
    plugin, declaration = plugin_fixture()
    plugin.settings("subscriptions", **declaration)
    contract = plugin.surface.describe(plugin)
    action = next(action for action in contract["actions"] if action["id"] == "resolve")
    action["input_schema"]["properties"]["unbound"] = {"type": "string"}
    action["input_schema"]["required"].append("unbound")
    assert any("无法从同组字段绑定" in error for error in validate_contract(contract))


def test_old_plugins_do_not_gain_settings_or_implicit_actions():
    plugin, _ = plugin_fixture()
    assert "settings" not in plugin.surface.describe(plugin)
