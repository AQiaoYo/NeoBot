"""静态契约检查不得执行插件，也不得泄露错误值。"""

from copy import deepcopy

import pytest

from neobot_modloader.sdk.contract import validate_contract


def make_contract() -> dict:
    return {
        "schema_version": 1,
        "plugin": {"name": "demo", "version": "1.0.0", "description": "示例"},
        "config": {"type": "object", "properties": {"enabled": {"type": "boolean"}}},
        "actions": [
            {"id": "items.list", "permission": "read", "input_schema": None, "output_schema": None},
            {"id": "items.add", "permission": "manage", "input_schema": None, "output_schema": None},
        ],
        "resources": [
            {
                "id": "items",
                "list_action": "items.list",
                "create_action": "items.add",
                "columns": [{"key": "name", "title": "名称"}],
            }
        ],
        "guides": [
            {
                "id": "first",
                "steps": [{"target": "config.enabled", "text": "开启功能"}],
                "completion_action": "items.list",
            }
        ],
    }


def test_valid_contract_is_checked_without_mutation() -> None:
    contract = make_contract()
    before = deepcopy(contract)
    assert validate_contract(contract) == []
    assert contract == before


@pytest.mark.parametrize("value", [None, [], True, {"schema_version": True}, {"schema_version": 2}])
def test_invalid_documents_return_diagnostics(value) -> None:
    assert validate_contract(value)


def test_cross_references_and_read_only_checks_are_validated() -> None:
    contract = make_contract()
    contract["resources"][0]["list_action"] = "items.add"
    contract["guides"][0]["completion_action"] = "missing"
    contract["guides"][0]["steps"][0]["target"] = "config.removed"
    errors = validate_contract(contract)
    assert any("list_action" in error for error in errors)
    assert any("completion_action" in error for error in errors)
    assert any("config.removed" in error for error in errors)


def test_duplicate_actions_are_not_silently_overwritten() -> None:
    contract = make_contract()
    contract["actions"].append(dict(contract["actions"][0]))
    assert any("items.list" in error for error in validate_contract(contract))


def test_sensitive_schema_defaults_are_rejected_without_echoing_values() -> None:
    contract = make_contract()
    contract["config"]["properties"]["cookie"] = {
        "type": "string",
        "default": "SESSDATA=synthetic-contract-value",
    }
    errors = validate_contract(contract)
    assert any("cookie" in error and "default" in error for error in errors)
    assert "synthetic-contract-value" not in str(errors)


def test_non_json_and_nonfinite_values_are_rejected() -> None:
    contract = make_contract()
    contract["plugin"]["extra"] = float("nan")
    assert validate_contract(contract)


def test_command_diagnostics_report_fields_without_echoing_author_values() -> None:
    contract = make_contract()
    contract["guides"][0]["steps"][0]["command"] = {
        "text": "",
        "context": 42,
        "reply": False,
        "execute": "synthetic-private-author-value",
    }
    assert validate_contract(contract) == [
        "guides.first.steps[0].command 只支持 text、context 和 reply",
        "guides.first.steps[0].command.text 必须是非空字符串",
        "guides.first.steps[0].command.context 必须是非空字符串",
        "guides.first.steps[0].command.reply 必须是非空字符串",
    ]


def test_contract_diagnostics_keep_declaration_and_field_order() -> None:
    contract = make_contract()
    contract["schema_version"] = 2
    contract["plugin"]["version"] = "invalid"
    contract["actions"][1]["permission"] = "root"
    contract["resources"][0].update(
        list_action="items.add", create_action="missing", columns=[{"key": "name"}, {"key": "name"}]
    )
    contract["views"] = [{"id": "panel", "title": "", "entry": "../outside.html", "anchors": ["row", "row"]}]
    contract["guides"][0].update(
        steps=[None, {"target": "view.panel.missing", "text": "", "chapter": "", "example": []}],
        demo={"actions": {"missing": {}}},
        completion_action="items.add",
    )
    assert validate_contract(contract) == [
        "schema_version 必须为整数 1",
        "plugin.version 无效",
        "actions.items.add.permission 必须为 read、operate 或 manage",
        "resources.items.list_action 必须引用 read 动作",
        "resources.items.create_action 引用了不存在的动作",
        "resources.items.columns 存在重复 key",
        "views.panel.title 不能为空",
        "views.panel.entry 必须是包内 HTML 路径",
        "views.panel.anchors 不能重复",
        "guides.first.steps[0] 必须是对象",
        "guides.first.steps[1].target 无效: view.panel.missing",
        "guides.first.steps[1].text 不能为空",
        "guides.first.steps[1].chapter 不能为空",
        "guides.first.steps[1].example 必须是对象",
        "guides.first.demo 引用了不存在的动作",
        "guides.first.completion_action 必须引用 read 动作",
    ]
