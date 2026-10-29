import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginAction } from '../api/types';
import { PluginSettingsContent } from '../pages/plugins/PluginDeclaredSettings';
import { actionInput, inputReady, settingFields } from '../pages/plugins/pluginSettingsModel';
import { settingsFixture } from './PluginDeclaredSettings.fixtures';

vi.mock('../notifications/infoBar', () => ({ infoBar: vi.fn(), notify: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('声明式选择器的依赖与失效', () => {
  it('重试预览失败后旧预览不再允许提交', async () => {
    const test = settingsFixture();
    let failing = false;
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.preview' && failing
        ? Promise.resolve({ ok: false, error: '第二次预览失败' })
        : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    await screen.findByRole('option', { name: '测试接收群' });
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
    fireEvent.input(screen.getByRole('textbox', { name: '直播间链接' }), { target: { value: '1001' } });
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    expect(await screen.findByTitle('预览通知')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始监听' })).toBeEnabled();
    failing = true;
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预览通知' })).toBeEnabled());
    expect(screen.queryByTitle('预览通知')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始监听' })).toBeDisabled();
  });

  it('字段声明的顺序和输入提示生效，未列字段仍继续展示', () => {
    const test = settingsFixture();
    const group = structuredClone(test.group);
    group.fields = [{ name: 'target', placeholder: '请输入目标直播间' }, ...group.fields!];
    const primary = test.actions.find((item) => item.id === group.input_action)!;
    expect(settingFields(primary, group, {}, {}).map((field) => field.name)).toEqual([
      'target',
      'group_id',
      'notify',
    ]);
    render(<PluginSettingsContent {...test} group={group} suspended />);
    expect(screen.getByPlaceholderText('请输入目标直播间')).toBeInTheDocument();
  });

  it('复杂字段使用 JSON 编辑器且保留相邻标量，提交时保持原始对象类型', async () => {
    const test = settingsFixture();
    const primary = test.actions.find((item) => item.id === test.group.input_action)!;
    const schema = primary.input_schema;
    if (!schema || typeof schema !== 'object') throw new Error('测试需要对象输入');
    primary.input_schema = {
      ...schema,
      properties: {
        ...schema.properties,
        payload: {
          type: 'object',
          title: '连接参数',
          properties: { retries: { type: 'integer' } },
          default: { retries: 3 },
        },
      },
    };
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    expect(screen.getByRole('textbox', { name: '连接参数' })).toHaveValue(
      JSON.stringify({ retries: 3 }, null, 2),
    );
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: '连接参数' }), {
      target: { value: '{"retries":5}' },
    });
    await screen.findByRole('option', { name: '测试接收群' });
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
    fireEvent.input(screen.getByRole('textbox', { name: '直播间链接' }), { target: { value: '1001' } });
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await user.click(screen.getByRole('button', { name: '开始监听' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: primary.id }),
      expect.objectContaining({ payload: { retries: 5 } }),
      true,
    );
  });

  it('根模型引用展开后仍按同一对象模型判断必填和筛选动作参数', () => {
    const test = settingsFixture();
    const primary = test.actions.find((item) => item.id === test.group.input_action)!;
    primary.input_schema = { $ref: '#/$defs/Input', $defs: { Input: primary.input_schema! } };
    expect(settingFields(primary, test.group, {}, {}).map((field) => field.name)).toEqual([
      'group_id',
      'target',
      'notify',
    ]);
    expect(inputReady(primary, { target: '1001' })).toBe(false);
    expect(inputReady(primary, { group_id: 42, target: '1001' })).toBe(true);
    expect(actionInput(primary, { group_id: 42, target: '1001', ignored: '不属于输入模型' })).toEqual({
      group_id: 42,
      target: '1001',
    });
  });

  it('依赖未填写时仍加载独立候选，选定上游后立即加载依赖候选', async () => {
    const test = settingsFixture();
    const group = structuredClone(test.group);
    const primary = test.actions.find((item) => item.id === group.input_action)!;
    const schema = primary.input_schema;
    if (!schema || typeof schema !== 'object') throw new Error('测试需要对象输入');
    primary.input_schema = {
      ...schema,
      properties: { ...schema.properties, channel_id: { type: 'integer', title: '频道' } },
      required: [...(schema.required ?? []), 'channel_id'],
    };
    const channels: PluginAction = {
      id: 'channels',
      title: '读取频道',
      permission: 'read',
      input_schema: { type: 'object', properties: { group_id: { type: 'integer' } }, required: ['group_id'] },
      output_schema: null,
    };
    test.actions.push(channels);
    group.fields!.push({
      name: 'channel_id',
      options: { action: 'channels', items: 'items', value: 'id', label: 'name' },
    });
    test.run.mockImplementation((definition, values, quiet) => {
      if (definition.id !== 'channels') return test.respond(definition, values, quiet);
      const input = values as Record<string, unknown>;
      return Promise.resolve(
        input.group_id
          ? { ok: true, result: { items: [{ id: 7, name: '测试频道' }] } }
          : { ok: false, error: '缺少群号' },
      );
    });
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} group={group} />);
    expect(await screen.findByRole('option', { name: '测试接收群' })).toBeInTheDocument();
    expect(test.run.mock.calls.some(([definition]) => definition.id === 'channels')).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
    expect(await screen.findByRole('option', { name: '测试频道' })).toBeInTheDocument();
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'channels' }),
      { group_id: 42 },
      true,
    );
  });

  it('候选刷新移除当前选择时清除旧预览并保留其他输入', async () => {
    const test = settingsFixture();
    let removed = false;
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.groups' && removed
        ? Promise.resolve({ ok: true, result: { items: [{ group_id: 99, name: '备用群' }] } })
        : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    const view = render(<PluginSettingsContent {...test} />);
    await screen.findByRole('option', { name: '测试接收群' });
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
    fireEvent.input(screen.getByRole('textbox', { name: '直播间链接' }), { target: { value: '1001' } });
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始监听' })).toBeEnabled());
    removed = true;
    view.rerender(<PluginSettingsContent {...test} suspended />);
    view.rerender(<PluginSettingsContent {...test} suspended={false} />);
    await waitFor(() => expect(screen.queryByRole('option', { name: '测试接收群' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '开始监听' })).toBeDisabled();
    expect(screen.queryByTitle('预览通知')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toHaveValue('1001');
  });
});
