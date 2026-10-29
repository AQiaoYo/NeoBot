import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginSettingsContent } from '../pages/plugins/PluginDeclaredSettings';
import PluginSettingsResults from '../pages/plugins/PluginSettingsResults';
import { ConfirmHost } from '../components/ui/ConfirmDialog';
import { infoBar } from '../notifications/infoBar';
import type { PluginActionPayload, PluginGuideDemo, PluginGuideStep } from '../api/types';
import { deferred, settingsFixture } from './PluginDeclaredSettings.fixtures';

vi.mock('../notifications/infoBar', () => ({ infoBar: vi.fn(), notify: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

async function fillSubscription(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: '测试接收群' });
  await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
  await user.type(screen.getByRole('textbox', { name: '直播间链接' }), 'https://live.bilibili.com/101');
}

describe('宿主渲染声明式插件设置', () => {
  it('状态摘要保留关键字段，展开后仍能查看完整诊断', async () => {
    const test = settingsFixture();
    const user = userEvent.setup();
    render(
      <PluginSettingsResults
        group={test.group}
        actions={test.actions}
        actionIds={['subscriptions.resolve']}
        compact
        results={{
          'subscriptions.resolve': {
            name: '测试主播',
            room_id: 101,
            active: false,
            checked_at: '2026-10-29T05:52:33Z',
            error: '示例错误',
          },
        }}
      />,
    );
    expect(screen.getByText('测试主播')).toBeVisible();
    expect(screen.getByText('否')).toBeVisible();
    expect(screen.getByText('示例错误')).toBeVisible();
    expect(screen.getByText('2026-10-29T05:52:33Z')).not.toBeVisible();
    await user.click(screen.getByText('查看完整状态'));
    expect(screen.getByText('示例错误')).toBeVisible();
    expect(screen.getByText('2026-10-29T05:52:33Z')).toBeVisible();
  });

  it('自动读取动态选项，按各动作的输入模型发送字段并保持数值类型', async () => {
    const test = settingsFixture();
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    expect(test.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'subscriptions.groups' }), {}, true);
    await user.click(screen.getByRole('button', { name: '识别直播间' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'subscriptions.resolve' }),
      { target: 'https://live.bilibili.com/101' },
      true,
    );
    expect(await screen.findByText('识别出的主播')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'subscriptions.preview' }),
      { group_id: 42, target: 'https://live.bilibili.com/101' },
      true,
    );
    const preview = await screen.findByTitle('预览通知');
    expect(preview).toHaveAttribute('sandbox', '');
    expect(preview).toHaveAttribute('srcdoc', expect.stringContaining('合成通知预览'));
    await user.click(screen.getByRole('button', { name: '开始监听' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'subscriptions.add' }),
      { group_id: 42, target: 'https://live.bilibili.com/101', notify: true },
      true,
    );
  });

  it('输入完整且预览成功后才允许提交，改变输入使旧预览失效', async () => {
    const test = settingsFixture();
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    const submit = screen.getByRole('button', { name: '开始监听' });
    expect(submit).toBeDisabled();
    await fillSubscription(user);
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await waitFor(() => expect(submit).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '99');
    expect(submit).toBeDisabled();
    expect(screen.queryByTitle('预览通知')).not.toBeInTheDocument();
    expect(test.run.mock.calls.filter(([definition]) => definition.id === 'subscriptions.add')).toHaveLength(
      0,
    );
  });

  it('失败的预览保留输入、显示错误，并且不允许提交', async () => {
    const test = settingsFixture();
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.preview'
        ? Promise.resolve({ ok: false, error: '合成图片生成失败' })
        : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await waitFor(() =>
      expect(infoBar).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'err', message: '合成图片生成失败' }),
      ),
    );
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toHaveValue('https://live.bilibili.com/101');
    expect(screen.getByRole('button', { name: '开始监听' })).toBeDisabled();
  });

  it('双击提交只发送一次写操作，期间禁止修改输入', async () => {
    const test = settingsFixture();
    const saving = deferred<PluginActionPayload>();
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.add' ? saving.promise : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await user.dblClick(screen.getByRole('button', { name: '开始监听' }));
    expect(test.run.mock.calls.filter(([definition]) => definition.id === 'subscriptions.add')).toHaveLength(
      1,
    );
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toBeDisabled();
    await act(async () => saving.resolve({ ok: true, result: { created: true } }));
    expect(await screen.findByRole('button', { name: '开始监听' })).toBeEnabled();
  });

  it('只读会话可以读取和预览，但创建、修改和删除全部禁止', async () => {
    const test = settingsFixture();
    test.surface.permissions = ['read'];
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await screen.findByTitle('预览通知');
    const listing = screen.getByRole('region', { name: '订阅列表' });
    expect(within(listing).getByRole('checkbox', { name: '开播推送' })).toBeDisabled();
    const remove = within(listing).getByRole('button', { name: '取消监听' });
    const submit = screen.getByRole('button', { name: '开始监听' });
    expect(remove).toBeDisabled();
    expect(submit).toBeDisabled();
    fireEvent.click(remove);
    fireEvent.click(submit);
    expect(test.run.mock.calls.every(([definition]) => definition.permission === 'read')).toBe(true);
  });

  it('暂停时忽略迟到的识别结果和通知', async () => {
    const test = settingsFixture();
    const request = deferred<PluginActionPayload>();
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.resolve' ? request.promise : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    const view = render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '识别直播间' }));
    view.rerender(<PluginSettingsContent {...test} suspended />);
    await act(async () => request.resolve({ ok: true, result: { name: '过期主播' } }));
    expect(screen.queryByText('过期主播')).not.toBeInTheDocument();
    expect(infoBar).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('暂停后恢复也不会应用暂停前迟到的 %s 响应', async (response) => {
    const test = settingsFixture();
    const request = deferred<PluginActionPayload>();
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.resolve' ? request.promise : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    const view = render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '识别直播间' }));
    view.rerender(<PluginSettingsContent {...test} suspended />);
    view.rerender(<PluginSettingsContent {...test} suspended={false} />);
    await act(async () =>
      request.resolve(
        response === 'success'
          ? { ok: true, result: { name: '恢复前的旧响应' } }
          : { ok: false, error: '暂停前的过期识别失败' },
      ),
    );
    expect(screen.queryByText('恢复前的旧响应')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toHaveValue('https://live.bilibili.com/101');
    expect(infoBar).not.toHaveBeenCalled();
  });

  it('卸载后到达的写失败不再弹出通知', async () => {
    const test = settingsFixture();
    const request = deferred<PluginActionPayload>();
    test.run.mockImplementation((definition, values, quiet) =>
      definition.id === 'subscriptions.add' ? request.promise : test.respond(definition, values, quiet),
    );
    const user = userEvent.setup();
    const view = render(<PluginSettingsContent {...test} />);
    await fillSubscription(user);
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await user.click(screen.getByRole('button', { name: '开始监听' }));
    view.unmount();
    await act(async () => request.resolve({ ok: false, error: '已经过期的失败' }));
    expect(infoBar).not.toHaveBeenCalled();
  });

  it('资源列表使用模型中的布尔开关保存，拒绝把服务端附加字段传回动作', async () => {
    const test = settingsFixture();
    const user = userEvent.setup();
    render(<PluginSettingsContent {...test} />);
    const listing = await screen.findByRole('region', { name: '订阅列表' });
    expect(await within(listing).findByText('测试主播')).toBeVisible();
    const toggle = within(listing).getByRole('checkbox', { name: '开播推送' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await user.click(within(listing).getByRole('button', { name: '保存推送设置' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'subscriptions.edit' }),
      { group_id: 42, room_id: 101, notify: false },
      true,
    );
    await waitFor(() =>
      expect(within(listing).queryByRole('button', { name: '保存推送设置' })).not.toBeInTheDocument(),
    );
    expect(within(listing).getByRole('checkbox', { name: '开播推送' })).not.toBeChecked();
  });

  it.each(['success', 'failure'] as const)(
    '写入后的新列表不被写入前迟到的 %s 读取覆盖',
    async (lateResponse) => {
      const test = settingsFixture();
      const staleRead = deferred<PluginActionPayload>();
      let reads = 0;
      test.run.mockImplementation((definition, values, quiet) => {
        if (definition.id === 'subscriptions.list' && ++reads === 2) return staleRead.promise;
        return test.respond(definition, values, quiet);
      });
      const view = render(<PluginSettingsContent {...test} />);
      const listing = await screen.findByRole('region', { name: '订阅列表' });
      expect(await within(listing).findByText('测试主播')).toBeVisible();
      view.rerender(<PluginSettingsContent {...test} suspended />);
      view.rerender(<PluginSettingsContent {...test} suspended={false} />);
      await waitFor(() => expect(reads).toBe(2));
      fireEvent.click(within(listing).getByRole('checkbox', { name: '开播推送' }));
      fireEvent.click(within(listing).getByRole('button', { name: '保存推送设置' }));
      await waitFor(() => expect(reads).toBe(3));
      await waitFor(() =>
        expect(within(listing).queryByRole('button', { name: '保存推送设置' })).not.toBeInTheDocument(),
      );
      expect(within(listing).getByRole('checkbox', { name: '开播推送' })).not.toBeChecked();
      await act(async () =>
        staleRead.resolve(
          lateResponse === 'success'
            ? {
                ok: true,
                result: { items: [{ group_id: 42, room_id: 101, name: '过期列表主播', notify: true }] },
              }
            : { ok: false, error: '已经过期的列表错误' },
        ),
      );
      expect(within(listing).getByText('测试主播')).toBeVisible();
      expect(within(listing).queryByText('过期列表主播')).not.toBeInTheDocument();
      expect(within(listing).getByRole('checkbox', { name: '开播推送' })).not.toBeChecked();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('删除须确认，取消不写入，确认后按模型发送标识并刷新空列表', async () => {
    const test = settingsFixture();
    const user = userEvent.setup();
    render(
      <>
        <ConfirmHost />
        <PluginSettingsContent {...test} />
      </>,
    );
    const listing = await screen.findByRole('region', { name: '订阅列表' });
    const remove = await within(listing).findByRole('button', { name: '取消监听' });
    await user.click(remove);
    let dialog = await screen.findByRole('dialog', { name: '取消监听？' });
    expect(test.run.mock.calls.some(([definition]) => definition.id === 'subscriptions.remove')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(test.run.mock.calls.some(([definition]) => definition.id === 'subscriptions.remove')).toBe(false);
    await user.click(remove);
    dialog = await screen.findByRole('dialog', { name: '取消监听？' });
    await user.click(within(dialog).getByRole('button', { name: '取消监听' }));
    await waitFor(() =>
      expect(test.run).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'subscriptions.remove' }),
        { group_id: 42, room_id: 101 },
        true,
      ),
    );
    expect(await within(listing).findByText('暂无记录，填写上方内容后即可添加。')).toBeVisible();
  });

  it('思索仅使用明确样例，不执行真实读取或写入', async () => {
    const test = settingsFixture();
    const step: PluginGuideStep = {
      target: 'settings.subscriptions.subscriptions.preview',
      text: '预览合成通知。',
      example: {
        group_id: 7,
        target: 'https://live.bilibili.com/700',
        notify: false,
        items: [{ group_id: 7, room_id: 700, name: '演示主播', notify: false }],
      },
    };
    const demo: PluginGuideDemo = {
      actions: {
        'subscriptions.groups': { items: [{ group_id: 7, name: '演示接收群' }] },
        'subscriptions.list': { items: [] },
        'subscriptions.preview': { html: '<p>仅供演示的通知</p>' },
      },
    };
    render(<PluginSettingsContent {...test} step={step} demo={demo} />);
    expect(await screen.findByRole('option', { name: '演示接收群' })).toBeInTheDocument();
    expect(await screen.findByText('演示主播')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toHaveValue('https://live.bilibili.com/700');
    expect(screen.getByTitle('预览通知')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('仅供演示的通知'),
    );
    expect(screen.getByRole('button', { name: '开始监听' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '接收群' })).toBeDisabled();
    expect(test.run).not.toHaveBeenCalled();
  });
});
