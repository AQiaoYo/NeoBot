"""校验设置控件对既有动作和资源的引用，声明不提升调用权限。"""

from typing import Any

from .settings import settings_structure_errors


def _resolve(value: Any, root: Any) -> dict[str, Any] | None:
    seen = set()
    while isinstance(value, dict) and "$ref" in value:
        reference = value["$ref"]
        if not isinstance(reference, str) or not reference.startswith("#/") or reference in seen:
            return None
        seen.add(reference)
        value = root
        for part in reference[2:].split("/"):
            if not isinstance(value, dict):
                return None
            value = value.get(part.replace("~1", "/").replace("~0", "~"))
    return value if isinstance(value, dict) else None


def _at(root: Any, path: str) -> dict[str, Any] | None:
    value = _resolve(root, root)
    for part in path.split(".") if path else ():
        if value is None:
            return None
        properties = value.get("properties", {})
        value = _resolve(properties.get(part), root) if isinstance(properties, dict) else None
    return value


def _properties(schema: Any) -> dict[str, Any] | None:
    resolved = _resolve(schema, schema)
    if resolved is None or resolved.get("type") != "object":
        return None
    properties = resolved.get("properties", {})
    return properties if isinstance(properties, dict) else None


def _action(
    actions: dict[str, dict[str, Any]],
    reference: Any,
    location: str,
    errors: list[str],
    *,
    read: bool,
) -> dict[str, Any] | None:
    action = actions.get(reference) if isinstance(reference, str) else None
    if action is None:
        errors.append(f"{location} 引用了不存在的动作")
        return None
    permission = action.get("permission")
    if (read and permission != "read") or (not read and permission not in ("operate", "manage")):
        errors.append(f"{location} 必须引用{'read' if read else '写'}动作")
    return action


def _input_errors(action: dict[str, Any], available: set[str], location: str, errors: list[str]) -> None:
    schema = action.get("input_schema")
    if schema is None:
        return
    properties = _properties(schema)
    if properties is None:
        errors.append(f"{location}.input_schema 必须是可绑定字段的对象")
        return
    required = schema.get("required", [])
    if not isinstance(required, list) or any(not isinstance(name, str) or name not in available for name in required):
        errors.append(f"{location}.input_schema 存在无法从同组字段绑定的必填项")


def _options_errors(
    options: dict[str, Any], actions: dict[str, dict[str, Any]], available: set[str], location: str, errors: list[str]
) -> None:
    action = _action(actions, options["action"], f"{location}.action", errors, read=True)
    if action is None:
        return
    _input_errors(action, available, location, errors)
    root = action.get("output_schema")
    collection = _at(root, options["items"])
    if collection is None or collection.get("type") != "array":
        errors.append(f"{location}.items 必须指向输出数组")
        return
    item = _resolve(collection.get("items"), root)
    for key in ("value", "label"):
        field = item
        for part in options[key].split(".") if options[key] else ():
            properties = field.get("properties", {}) if field else None
            field = _resolve(properties.get(part), root) if isinstance(properties, dict) else None
        if field is None or field.get("type") not in ("string", "integer", "number", "boolean"):
            errors.append(f"{location}.{key} 必须指向候选项标量字段")


def _resource_errors(
    group: dict[str, Any],
    actions: dict[str, dict[str, Any]],
    resources: dict[str, dict[str, Any]],
    available: set[str],
    location: str,
    errors: list[str],
) -> None:
    resource = resources.get(group.get("resource"))
    if resource is None:
        errors.append(f"{location}.resource 引用了不存在的资源")
        return
    listing = _action(actions, resource.get("list_action"), f"{location}.resource.list_action", errors, read=True)
    row_names: set[str] = set()
    if listing is not None:
        _input_errors(listing, available, f"{location}.resource", errors)
        root = listing.get("output_schema")
        collection = _at(root, "items") if _properties(root) is not None else _resolve(root, root)
        item = _resolve(collection.get("items"), root) if collection else None
        if collection is None or collection.get("type") != "array" or item is None:
            errors.append(f"{location}.resource 必须返回数组或含 items 数组的对象")
        elif isinstance(item.get("properties"), dict):
            row_names = set(item["properties"])
    deletion = resource.get("delete_action")
    if deletion is not None:
        action = _action(actions, deletion, f"{location}.resource.delete_action", errors, read=False)
        if action is not None:
            _input_errors(action, row_names, f"{location}.resource.delete_action", errors)
    if group.get("edit_action") is None:
        return
    edit = _action(actions, group["edit_action"], f"{location}.edit_action", errors, read=False)
    if edit is None:
        return
    _input_errors(edit, row_names, f"{location}.edit_action", errors)
    root = edit.get("input_schema")
    for name in group.get("switch_fields", []):
        field = _at(root, name)
        if name not in row_names or field is None or field.get("type") != "boolean":
            errors.append(f"{location}.switch_fields 必须引用行数据及编辑输入中的布尔字段")


def validate_settings(
    groups: dict[str, dict[str, Any]], actions: dict[str, dict[str, Any]], resources: dict[str, dict[str, Any]]
) -> list[str]:
    """运行时和静态导出检查共用引用规则；诊断不包含默认值或业务输入。"""
    errors: list[str] = []
    for name, group in groups.items():
        location = f"settings.{name}"
        structural = settings_structure_errors(group, location)
        if structural:
            errors.extend(structural)
            continue
        primary = _action(actions, group["input_action"], f"{location}.input_action", errors, read=False)
        properties = _properties(primary.get("input_schema")) if primary else None
        if properties is None:
            errors.append(f"{location}.input_action 必须声明对象输入模型")
            continue
        available = set(properties)
        helpers = {button["action"] for button in group.get("actions", [])}
        if group.get("require_action") is not None and group["require_action"] not in helpers:
            errors.append(f"{location}.require_action 必须引用同组辅助动作")
        for index, field in enumerate(group.get("fields", [])):
            target = f"{location}.fields[{index}]"
            if field["name"] not in available:
                errors.append(f"{target}.name 必须引用主动作输入字段")
            if field.get("options") is not None:
                _options_errors(field["options"], actions, available, f"{target}.options", errors)
        for index, button in enumerate(group.get("actions", [])):
            target = f"{location}.actions[{index}]"
            action = _action(actions, button["action"], f"{target}.action", errors, read=True)
            if action is None:
                continue
            _input_errors(action, available, target, errors)
            if button.get("display", "summary") == "html":
                html = _at(action.get("output_schema"), "html")
                if html is None or html.get("type") != "string":
                    errors.append(f"{target}.display=html 要求输出包含 html 字符串")
        if group.get("resource") is not None:
            _resource_errors(group, actions, resources, available, location, errors)
    return errors


def settings_targets(groups: dict[str, dict[str, Any]], actions: dict[str, dict[str, Any]]) -> set[str]:
    """教程引用实际宿主控件，无需为相同字段再声明页面锚点。"""
    targets = set()
    for name, group in groups.items():
        prefix = f"settings.{name}"
        targets.add(prefix)
        action = actions.get(group.get("input_action"), {})
        properties = _properties(action.get("input_schema")) or {}
        targets.update(f"{prefix}.{field}" for field in properties)
        targets.add(f"{prefix}.{group.get('input_action')}")
        targets.update(f"{prefix}.{button['action']}" for button in group.get("actions", []))
        if group.get("resource") is not None:
            targets.add(f"{prefix}.resource")
    return targets
