"""插件配置与业务界面的公开契约。"""

from .actions import ActionError, ActionInvocation, ActionPermission
from .surface import GuideDefinition, PluginSurface, ResourceDefinition, SurfaceContractError
from .settings import SettingsDefinition

__all__ = [
    "ActionError",
    "ActionInvocation",
    "ActionPermission",
    "GuideDefinition",
    "PluginSurface",
    "ResourceDefinition",
    "SettingsDefinition",
    "SurfaceContractError",
]
