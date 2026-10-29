import { vi } from 'vitest';
import type { JsonSchema, PluginAction, PluginActionPayload, PluginSettingsGroup } from '../api/types';
import type { PluginViewSurface, RunPluginAction } from '../pages/plugins/pluginViewBridge';

const schema = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const groupId: JsonSchema = { type: 'integer', title: '接收群' };
const roomId: JsonSchema = { type: 'integer', title: '直播间编号' };
const target: JsonSchema = { type: 'string', title: '直播间链接' };
const notify: JsonSchema = { type: 'boolean', title: '开播推送', default: true };
const action = (
  id: string,
  title: string,
  input: JsonSchema,
  permission: PluginAction['permission'] = 'read',
  output: JsonSchema | null = null,
): PluginAction => ({
  id,
  title,
  permission,
  input_schema: input,
  output_schema: output,
});

export const group: PluginSettingsGroup = {
  id: 'subscriptions',
  title: '直播订阅',
  input_action: 'subscriptions.add',
  submit_label: '开始监听',
  require_action: 'subscriptions.preview',
  fields: [
    {
      name: 'group_id',
      options: { action: 'subscriptions.groups', items: 'items', value: 'group_id', label: 'name' },
    },
  ],
  actions: [
    { action: 'subscriptions.resolve', label: '识别直播间', display: 'summary' },
    { action: 'subscriptions.preview', label: '预览通知', display: 'html' },
  ],
  resource: 'subscriptions',
  edit_action: 'subscriptions.edit',
  switch_fields: ['notify'],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function settingsFixture() {
  let rows: Record<string, unknown>[] = [
    {
      group_id: 42,
      room_id: 101,
      name: '测试主播',
      notify: true,
      server_note: '服务端附加字段',
    },
  ];
  const actions = [
    action('subscriptions.groups', '读取群目录', schema({})),
    action(
      'subscriptions.resolve',
      '识别直播间',
      schema({ target }),
      'read',
      schema({ name: { type: 'string', title: '主播名称' }, room_id: roomId }),
    ),
    action('subscriptions.preview', '预览通知', schema({ group_id: groupId, target })),
    action(
      'subscriptions.add',
      '开始监听',
      schema({ group_id: groupId, target, notify }, ['group_id', 'target']),
      'manage',
    ),
    action('subscriptions.list', '读取订阅', schema({})),
    action(
      'subscriptions.edit',
      '保存推送设置',
      schema({ group_id: groupId, room_id: roomId, notify }),
      'manage',
    ),
    action('subscriptions.remove', '取消监听', schema({ group_id: groupId, room_id: roomId }), 'manage'),
  ];
  const surface: PluginViewSurface = {
    available: true,
    state: 'loaded',
    source: 'runtime',
    permissions: ['read', 'operate', 'manage'],
    contract: {
      schema_version: 1,
      plugin: { name: 'streaming_parser' },
      config: null,
      actions,
      guides: [],
      settings: [group],
      resources: [
        {
          id: 'subscriptions',
          title: '订阅列表',
          list_action: 'subscriptions.list',
          delete_action: 'subscriptions.remove',
          columns: [
            { key: 'name', title: '主播' },
            { key: 'room_id', title: '直播间编号' },
          ],
        },
      ],
    },
  };
  const respond: RunPluginAction = async (definition, input): Promise<PluginActionPayload> => {
    const values = input as Record<string, unknown>;
    switch (definition.id) {
      case 'subscriptions.groups':
        return {
          ok: true,
          result: {
            items: [
              { group_id: 42, name: '测试接收群' },
              { group_id: 99, name: '备用群' },
            ],
          },
        };
      case 'subscriptions.resolve':
        return { ok: true, result: { name: '识别出的主播', room_id: 101 } };
      case 'subscriptions.preview':
        return { ok: true, result: { html: '<p>合成通知预览</p>', fallback_text: '合成通知文字' } };
      case 'subscriptions.list':
        return { ok: true, result: { items: structuredClone(rows) } };
      case 'subscriptions.edit':
        rows = rows.map((row) => (row.room_id === values.room_id ? { ...row, notify: values.notify } : row));
        return { ok: true, result: { saved: true } };
      case 'subscriptions.remove':
        rows = rows.filter((row) => row.room_id !== values.room_id);
        return { ok: true, result: { removed: true } };
      default:
        return { ok: true, result: { created: true } };
    }
  };
  const run = vi.fn<RunPluginAction>(respond);
  return { surface, group, run, respond, actions };
}
