"""宿主设置分组的有限控件声明，不执行表达式或插件页面脚本。"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
import re
from typing import Any

from .actions import validate_id

_SEGMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*\Z")
_GROUP_KEYS = {
    "id",
    "title",
    "description",
    "collapsed",
    "input_action",
    "submit_label",
    "require_action",
    "fields",
    "actions",
    "resource",
    "edit_action",
    "switch_fields",
}
_FIELD_KEYS = {"name", "control", "placeholder", "description", "options"}
_BUTTON_KEYS = {"action", "label", "display"}
_OPTION_KEYS = {"action", "items", "value", "label"}


def _text(value: Any, *, empty: bool = False) -> bool:
    return isinstance(value, str) and (empty or bool(value.strip()))


def _identifier(value: Any, *, segment: bool = False) -> bool:
    try:
        validate_id(value, kind="设置")
    except (TypeError, ValueError):
        return False
    return not segment or "." not in value


def _field_name(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(_SEGMENT.fullmatch(value))
        and value not in {"__proto__", "constructor", "prototype"}
    )


def _path(value: Any) -> bool:
    return isinstance(value, str) and (not value or all(_field_name(part) for part in value.split(".")))


def _options_errors(value: Any, location: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, dict) or set(value) != _OPTION_KEYS:
        return [f"{location} 必须包含 action、items、value、label"]
    errors = []
    if not _identifier(value.get("action")):
        errors.append(f"{location}.action 无效")
    for key in ("items", "value", "label"):
        if not _path(value.get(key)):
            errors.append(f"{location}.{key} 必须是字段路径，空字符串表示根值")
    return errors


def _fields_errors(values: Any, location: str) -> list[str]:
    if not isinstance(values, list):
        return [f"{location} 必须是列表"]
    errors = []
    names = set()
    for index, field in enumerate(values):
        target = f"{location}[{index}]"
        if not isinstance(field, dict) or set(field) - _FIELD_KEYS:
            errors.append(f"{target} 只支持 name、control、placeholder、description、options")
            continue
        name = field.get("name")
        if not _field_name(name):
            errors.append(f"{target}.name 必须是稳定字段名")
        elif name in names:
            errors.append(f"{target}.name 重复")
        else:
            names.add(name)
        control = field.get("control", "auto")
        if not isinstance(control, str) or control not in {"auto", "text", "select"}:
            errors.append(f"{target}.control 必须是 auto、text 或 select")
        for key in ("placeholder", "description"):
            if not _text(field.get(key, ""), empty=True):
                errors.append(f"{target}.{key} 必须是字符串")
        errors.extend(_options_errors(field.get("options"), f"{target}.options"))
        if field.get("options") is not None and control not in ("auto", "select"):
            errors.append(f"{target}.options 只能用于选择控件")
    return errors


def _buttons_errors(values: Any, location: str) -> list[str]:
    if not isinstance(values, list):
        return [f"{location} 必须是列表"]
    errors = []
    names = set()
    for index, button in enumerate(values):
        target = f"{location}[{index}]"
        if not isinstance(button, dict) or set(button) - _BUTTON_KEYS:
            errors.append(f"{target} 只支持 action、label、display")
            continue
        action = button.get("action")
        if not _identifier(action):
            errors.append(f"{target}.action 无效")
        elif action in names:
            errors.append(f"{target}.action 重复")
        else:
            names.add(action)
        if not _text(button.get("label", ""), empty=True):
            errors.append(f"{target}.label 必须是字符串")
        display = button.get("display", "summary")
        if not isinstance(display, str) or display not in {"summary", "html"}:
            errors.append(f"{target}.display 必须是 summary 或 html")
    return errors


def settings_structure_errors(value: Any, location: str) -> list[str]:
    """运行时声明和不导入插件的静态检查共用同一结构边界。"""
    if not isinstance(value, dict) or set(value) - _GROUP_KEYS:
        return [f"{location} 含未知设置声明字段"]
    errors = []
    if not _identifier(value.get("id"), segment=True):
        errors.append(f"{location}.id 必须是无点号的稳定 ID")
    if not _text(value.get("title")):
        errors.append(f"{location}.title 不能为空")
    for key in ("description", "submit_label"):
        if not _text(value.get(key, ""), empty=True):
            errors.append(f"{location}.{key} 必须是字符串")
    if type(value.get("collapsed", False)) is not bool:
        errors.append(f"{location}.collapsed 必须是布尔值")
    if not _identifier(value.get("input_action")):
        errors.append(f"{location}.input_action 无效")
    for key in ("require_action", "resource", "edit_action"):
        if value.get(key) is not None and not _identifier(value[key]):
            errors.append(f"{location}.{key} 无效")
    errors.extend(_fields_errors(value.get("fields", []), f"{location}.fields"))
    errors.extend(_buttons_errors(value.get("actions", []), f"{location}.actions"))
    switches = value.get("switch_fields", [])
    if not isinstance(switches, list) or not all(_field_name(item) for item in switches):
        errors.append(f"{location}.switch_fields 必须是字段名列表")
    elif len(set(switches)) != len(switches):
        errors.append(f"{location}.switch_fields 不能重复")
    if (value.get("edit_action") or switches) and not value.get("resource"):
        errors.append(f"{location}.resource 是表格编辑的必要声明")
    if switches and not value.get("edit_action"):
        errors.append(f"{location}.edit_action 是开关编辑的必要声明")
    return errors


@dataclass(frozen=True)
class SettingsDefinition:
    """描述副本可独立序列化，调用方不能通过返回值改写登记内容。"""

    id: str
    declaration: dict[str, Any]

    def describe(self) -> dict[str, Any]:
        return json.loads(json.dumps(self.declaration, ensure_ascii=False, allow_nan=False))


def make_settings(
    id: str,
    *,
    title: str,
    input_action: str,
    description: str = "",
    collapsed: bool = False,
    submit_label: str = "",
    require_action: str | None = None,
    fields: Sequence[Mapping[str, Any]] = (),
    actions: Sequence[Mapping[str, Any]] = (),
    resource: str | None = None,
    edit_action: str | None = None,
    switch_fields: Sequence[str] = (),
) -> SettingsDefinition:
    """只登记有限控件；字段类型、约束和动作权限继续来自原契约。"""
    for values, name in ((fields, "fields"), (actions, "actions"), (switch_fields, "switch_fields")):
        if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
            raise ValueError(f"settings.{name} 必须是列表")
    declaration = {
        "id": id,
        "title": title,
        "description": description,
        "collapsed": collapsed,
        "input_action": input_action,
        "submit_label": submit_label,
        "require_action": require_action,
        "fields": list(fields),
        "actions": list(actions),
        "resource": resource,
        "edit_action": edit_action,
        "switch_fields": list(switch_fields),
    }
    try:
        declaration = json.loads(json.dumps(declaration, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError, RecursionError):
        raise ValueError("设置声明必须包含有限、可序列化的 JSON 值") from None
    errors = settings_structure_errors(declaration, "settings")
    if errors:
        raise ValueError("；".join(errors))
    for field in declaration["fields"]:
        field.setdefault("control", "auto")
        field.setdefault("placeholder", "")
        field.setdefault("description", "")
        field.setdefault("options", None)
    for button in declaration["actions"]:
        button.setdefault("label", "")
        button.setdefault("display", "summary")
    return SettingsDefinition(id, declaration)
