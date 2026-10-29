"""流媒体完整订阅业务：共用规则、真实落库、预览与真实轮询完成条件。"""

import asyncio
from types import SimpleNamespace

import pytest

from neobot_app.builtin_plugins.streaming_parser import db
from neobot_modloader import Plugin
from neobot_modloader.sdk import ActionError, ActionInvocation

from streaming_panel_helpers import make_state


@pytest.fixture
async def state(tmp_path):
    value = await make_state(tmp_path)
    try:
        yield value
    finally:
        await value.stop_polling()
        await value.database.close()


def caller(permission="manage"):
    return ActionInvocation("streaming-test", frozenset({permission}))


def surface(state):
    from neobot_app.builtin_plugins.streaming_parser.panel import register_surface

    plugin = Plugin("streaming_parser", version="0.3.1")
    register_surface(plugin, state)
    return plugin


async def invoke(plugin, action, values=None, permission="manage"):
    return await plugin.surface.invoke(plugin, "subscriptions." + action, values or {}, caller(permission))


async def test_subscription_service_preserves_group_defaults_and_existing_switches(state):
    from neobot_app.builtin_plugins.streaming_parser.subscriptions import SubscriptionService

    async with state.database.transaction() as session:
        await db.ensure_group_setting(session, 20001, {"default_push_live": False, "default_push_live_end": True})
    service = SubscriptionService(state)
    row, created = await service.create(20001, "https://live.bilibili.com/1001")
    assert created is True
    assert (row.room_id, row.push_live, row.push_live_end) == (610001, False, True)
    await service.toggle(20001, 610001, push_live=True, push_live_end=False)
    row, created = await service.create(20001, "uid:510001")
    assert created is False
    assert (row.push_live, row.push_live_end) == (True, False)


async def test_panel_uses_live_group_directory_and_rejects_forged_group(state):
    plugin = surface(state)
    groups = await invoke(plugin, "groups", permission="read")
    assert groups == {"items": [{"group_id": 20001, "name": "演示交流组", "bot_id": "10001"}]}
    with pytest.raises(ActionError) as error:
        await invoke(plugin, "create", {"group_id": 99999, "target": "1001"})
    assert error.value.code == "group_unavailable"
    async with state.database.session() as session:
        assert await db.distinct_room_ids(session) == []


async def test_group_transport_failure_keeps_public_error_and_logs_only_failure_type(state, monkeypatch):
    warnings = []

    async def unavailable(action, params):
        raise RuntimeError("https://adapter.invalid/?token=synthetic-view-token")

    monkeypatch.setattr(state.ctx.adapter, "call_api", unavailable)
    monkeypatch.setattr(state.ctx.logger, "warning", warnings.append)
    with pytest.raises(ActionError) as error:
        await invoke(surface(state), "groups", permission="read")
    assert error.value.code == "group_list_unavailable"
    assert error.value.message == "暂时无法读取机器人所在的群，请检查机器人连接。"
    assert warnings == ["读取机器人群目录失败，适配器异常类型：RuntimeError"]


async def test_group_response_validation_does_not_log_the_private_response(state, monkeypatch):
    warnings = []

    async def malformed(action, params):
        return {
            "status": "ok",
            "retcode": 0,
            "data": [{"group_id": "synthetic-private-business-input", "group_name": "合成群目录"}],
        }

    monkeypatch.setattr(state.ctx.adapter, "call_api", malformed)
    monkeypatch.setattr(state.ctx.logger, "warning", warnings.append)
    with pytest.raises(ActionError) as error:
        await invoke(surface(state), "groups", permission="read")
    assert error.value.code == "group_list_unavailable"
    assert error.value.message == "暂时无法读取机器人所在的群，请检查机器人连接。"
    assert warnings == ["机器人群目录响应结构无效，请检查适配器返回格式。"]


async def test_readonly_cannot_create_or_change_data(state):
    plugin = surface(state)
    with pytest.raises(ActionError) as error:
        await invoke(plugin, "create", {"group_id": 20001, "target": "1001"}, permission="read")
    assert error.value.code == "permission_denied"
    assert (await invoke(plugin, "list", permission="read"))["items"] == []


async def test_preview_uses_notification_template_without_creating_or_sending(state):
    plugin = surface(state)
    preview = await invoke(plugin, "preview", {"group_id": 20001, "target": "1001"}, permission="read")
    assert preview["target"]["room_id"] == 610001
    assert "演示主播" in preview["html"]
    assert "一起认识新的插件面板" in preview["html"]
    assert "card" in preview["html"]
    assert "一起认识新的插件面板" in preview["fallback_text"]
    assert state.ctx.adapter.sent == []
    assert (await invoke(plugin, "list", permission="read"))["items"] == []


async def test_first_subscription_wakes_real_poller_and_completion_is_not_just_saved(state):
    plugin = surface(state)
    created = await invoke(plugin, "create", {"group_id": 20001, "target": "1001"})
    assert created["created"] is True
    assert (await invoke(plugin, "ready", permission="read"))["completed"] is False
    await state.start_polling()

    async def observed():
        while True:
            ready = await invoke(plugin, "ready", permission="read")
            if ready["completed"]:
                return ready
            await asyncio.sleep(0.01)

    assert (await asyncio.wait_for(observed(), 2))["completed"] is True
    health = await invoke(plugin, "health", permission="read")
    assert health["running"] is True
    assert health["subscriptions"] == 1
    assert health["success_at"] is not None
    assert state.client.queried == [610001]
    await state.stop_polling()
    assert (await invoke(plugin, "ready", permission="read"))["completed"] is False


async def test_subscribing_after_empty_initial_poll_does_not_wait_for_interval(state):
    plugin = surface(state)
    await state.start_polling()
    await asyncio.sleep(0)
    await invoke(plugin, "create", {"group_id": 20001, "target": "1001"})

    async def observed():
        while not state.client.queried:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(observed(), 2)
    assert state.client.queried == [610001]


async def test_list_toggle_and_remove_use_saved_records(state):
    plugin = surface(state)
    await invoke(plugin, "create", {"group_id": 20001, "target": "1001"})
    row = (await invoke(plugin, "list", permission="read"))["items"][0]
    assert row["name"] == "演示主播"
    changed = await invoke(
        plugin, "toggle", {"group_id": 20001, "room_id": 610001, "push_live": False, "push_live_end": True}
    )
    assert changed["item"]["push_live"] is False
    assert changed["item"]["push_live_end"] is True
    assert await invoke(plugin, "remove", {"group_id": 20001, "room_id": 610001}) == {"removed": True}
    assert (await invoke(plugin, "list", permission="read"))["items"] == []


async def test_declared_settings_reach_existing_subscription_actions_without_a_custom_page(state):
    plugin = surface(state)
    contract = plugin.surface.describe(plugin)
    assert not contract.get("views")
    group = contract["settings"][0]
    assert group["collapsed"] is False
    assert group["require_action"] == "subscriptions.preview"
    assert group["edit_action"] == "subscriptions.toggle"
    assert group["switch_fields"] == ["push_live", "push_live_end"]
    source = group["fields"][0]["options"]
    choices = await plugin.surface.invoke(plugin, source["action"], {}, caller("read"))
    selected = choices[source["items"]][0][source["value"]]
    values = {"group_id": selected, "target": "1001"}
    helpers = {button["action"]: button for button in group["actions"]}
    assert helpers["subscriptions.preview"]["display"] == "html"
    resolved = await invoke(plugin, "resolve", {"target": values["target"]}, permission="read")
    assert resolved["room_id"] == 610001
    preview = await plugin.surface.invoke(plugin, group["require_action"], values, caller("read"))
    assert "演示主播" in preview["html"]
    assert state.ctx.adapter.sent == []
    assert (await invoke(plugin, "list", permission="read"))["items"] == []
    await plugin.surface.invoke(plugin, group["input_action"], values, caller())
    resource = next(item for item in contract["resources"] if item["id"] == group["resource"])
    row = (await plugin.surface.invoke(plugin, resource["list_action"], {}, caller("read")))["items"][0]
    edited = {key: row[key] for key in ("group_id", "room_id", "push_live", "push_live_end")}
    edited["push_live"] = False
    await plugin.surface.invoke(plugin, group["edit_action"], edited, caller())
    assert (await invoke(plugin, "list", permission="read"))["items"][0]["push_live"] is False
    assert (await invoke(plugin, "health", permission="read"))["subscriptions"] == 1
    await plugin.surface.invoke(
        plugin, resource["delete_action"], {"group_id": row["group_id"], "room_id": row["room_id"]}, caller()
    )
    assert (await invoke(plugin, "list", permission="read"))["items"] == []


async def test_manager_can_manage_saved_subscription_after_bot_leaves_group(state, monkeypatch):
    plugin = surface(state)
    await invoke(plugin, "create", {"group_id": 20001, "target": "1001"})

    async def no_groups(*arguments, **options):
        return {"status": "ok", "retcode": 0, "data": []}

    monkeypatch.setattr(state.ctx.adapter, "call_api", no_groups)
    assert await invoke(plugin, "groups", permission="read") == {"items": []}
    with pytest.raises(ActionError) as error:
        await invoke(plugin, "remove", {"group_id": 20001, "room_id": 610001}, permission="read")
    assert error.value.code == "permission_denied"
    changed = await invoke(
        plugin, "toggle", {"group_id": 20001, "room_id": 610001, "push_live": False, "push_live_end": False}
    )
    assert changed["item"]["push_live"] is False
    assert changed["item"]["push_live_end"] is False
    assert await invoke(plugin, "remove", {"group_id": 20001, "room_id": 610001}) == {"removed": True}
    assert (await invoke(plugin, "list", permission="read"))["items"] == []


async def test_health_explains_platform_failure_from_actual_poll(state):
    plugin = surface(state)
    await invoke(plugin, "create", {"group_id": 20001, "target": "1001"})
    state.client.fail = True
    await state.poller.poll_once()
    health = await invoke(plugin, "health", permission="read")
    assert health["failed"] == 1
    assert health["checked"] == 0
    assert health["checked_at"] is not None
    assert health["success_at"] is None
    assert "610001" in health["error"]
    assert "合成的外部连接失败" not in health["error"]


async def test_chat_and_panel_keep_the_same_group_defaults_and_existing_switches(state):
    from neobot_app.builtin_plugins.streaming_parser.commands import register_commands

    handlers = {}

    class Registrar:
        available = True

        def register(self, name, **metadata):
            def decorate(handler):
                handlers[name] = handler
                return handler

            return decorate

    replies = []

    async def reply(text):
        replies.append(text)

    context = SimpleNamespace(kind="group", conv_id="20001", args=["1001"], reply_plain=reply)
    command_host = SimpleNamespace(app_commands=Registrar(), logger=state.ctx.logger, screenshots=None)
    async with state.database.transaction() as session:
        await db.ensure_group_setting(session, 20001, {"default_push_live": False, "default_push_live_end": True})
    register_commands(command_host, state)
    await handlers["监听"](context)
    plugin = surface(state)
    row = (await invoke(plugin, "list", permission="read"))["items"][0]
    assert row["push_live"] is False and row["push_live_end"] is True
    await invoke(plugin, "toggle", {"group_id": 20001, "room_id": 610001, "push_live": True, "push_live_end": False})
    await handlers["监听"](context)
    row = (await invoke(plugin, "list", permission="read"))["items"][0]
    assert row["push_live"] is True and row["push_live_end"] is False
    assert len(replies) == 2
