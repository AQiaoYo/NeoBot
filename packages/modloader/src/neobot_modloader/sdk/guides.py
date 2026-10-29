"""说明书命令样例的结构校验；不检查注册状态，也不执行命令。"""

from __future__ import annotations

from typing import Any


def guide_command_errors(value: Any, location: str) -> list[str]:
    """声明与静态契约共用相同字段规则，诊断不回显作者填写的内容。"""
    if not isinstance(value, dict):
        return [f"{location} 必须是对象"]
    errors = []
    if set(value) - {"text", "context", "reply"}:
        errors.append(f"{location} 只支持 text、context 和 reply")
    for key in ("text", "context", "reply"):
        if key == "reply" and key not in value:
            continue
        text = value.get(key)
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{location}.{key} 必须是非空字符串")
    return errors
