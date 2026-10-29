import type { ComponentProps } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/endpoints';
import type { PluginView } from '../api/types';
import { clearQueries, setQueryData } from '../data/queryCore';
import { QK } from '../data/queryKeys';
import { infoBar } from '../notifications/infoBar';
import PluginSettingsViews from '../pages/plugins/PluginSettingsViews';
import PluginViewFrame from '../pages/plugins/PluginViewFrame';
import type { PluginViewSurface } from '../pages/plugins/pluginViewBridge';

vi.mock('../api/endpoints', () => ({
  api: { pluginViews: vi.fn(), pluginAction: vi.fn(), pluginConfigSave: vi.fn() },
}));
vi.mock('../notifications/infoBar', () => ({ infoBar: vi.fn() }));
vi.mock('../pages/plugins/PluginViewFrame', () => ({
  default: vi.fn((props: ComponentProps<typeof PluginViewFrame>) => (
    <iframe title={props.view.title} src={props.view.url} data-mode={props.mode} />
  )),
}));

const view: PluginView & { url: string } = {
  id: 'editor',
  title: '订阅设置',
  entry: 'web/index.html',
  anchors: ['target'],
  url: '/plugins-ui/demo/editor/?revision=one',
};
const surface: PluginViewSurface = {
  available: true,
  state: 'loaded',
  source: 'runtime',
  permissions: ['read', 'manage'],
  contract: {
    schema_version: 1,
    plugin: { name: 'demo' },
    config: null,
    actions: [],
    resources: [],
    guides: [],
    views: [view],
  },
};

function props(): ComponentProps<typeof PluginSettingsViews> {
  return {
    pluginId: 'demo',
    surface,
    suspended: false,
    run: vi.fn(),
    configAccess: { get: vi.fn(), save: vi.fn() },
    onNavigate: vi.fn(),
  };
}

async function expand() {
  const summary = await screen.findByText('订阅设置', { selector: 'summary' });
  if (!summary.closest('details')?.open) await userEvent.click(summary);
  return screen.findByTitle<HTMLIFrameElement>('订阅设置');
}

beforeEach(() => {
  vi.clearAllMocks();
  clearQueries();
  vi.mocked(api.pluginViews).mockResolvedValue({
    ok: true,
    status: 200,
    error: null,
    data: { ok: true, items: [view] },
  });
});

describe('插件设置中的独立页面分组', () => {
  it('未声明页面时不渲染、不读取元信息', () => {
    const value = props();
    const { container } = render(
      <PluginSettingsViews
        {...value}
        surface={{ ...surface, contract: { ...surface.contract, views: [] } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(api.pluginViews).not.toHaveBeenCalled();
    expect(PluginViewFrame).not.toHaveBeenCalled();
  });

  it('读取期间展示短骨架，读取完成后直接展示首个设置分组', async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.pluginViews>>) => void;
    vi.mocked(api.pluginViews).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PluginSettingsViews {...props()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取插件设置…');
    expect(PluginViewFrame).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, status: 200, error: null, data: { ok: true, items: [view] } }));
    expect(screen.getByText('订阅设置', { selector: 'summary' })).toBeVisible();
    expect(screen.getByRole('group', { name: '订阅设置' })).toHaveAttribute('open');
    expect(screen.getByTitle('订阅设置')).toBeVisible();
    expect(vi.mocked(PluginViewFrame).mock.lastCall![0].layout).toBe('inline');
  });

  it('展开后建立 live 页面并透传当前权限、配置访问与业务回调', async () => {
    const value = props();
    render(<PluginSettingsViews {...value} />);
    const frame = await expand();
    expect(frame).toHaveAttribute('data-mode', 'live');
    expect(frame).toHaveAttribute('src', view.url);
    const frameProps = vi.mocked(PluginViewFrame).mock.lastCall![0];
    expect(frameProps.pluginId).toBe(value.pluginId);
    expect(frameProps.surface).toBe(value.surface);
    expect(frameProps.run).toBe(value.run);
    expect(frameProps.configAccess).toBe(value.configAccess);
    expect(frameProps.onNavigate).toBe(value.onNavigate);
    expect(frameProps.suspended).toBe(false);
    expect(value.run).not.toHaveBeenCalled();
    expect(value.configAccess.get).not.toHaveBeenCalled();
    expect(value.configAccess.save).not.toHaveBeenCalled();
    expect(api.pluginAction).not.toHaveBeenCalled();
    expect(api.pluginConfigSave).not.toHaveBeenCalled();
  });

  it('收起后暂停页面，再次展开保留原会话和输入', async () => {
    render(<PluginSettingsViews {...props()} />);
    const first = await expand();
    await userEvent.click(screen.getByText('订阅设置', { selector: 'summary' }));
    await waitFor(() => expect(vi.mocked(PluginViewFrame).mock.lastCall![0].suspended).toBe(true));
    expect(screen.getByTitle('订阅设置')).toBe(first);
    expect(await expand()).toBe(first);
    await waitFor(() => expect(vi.mocked(PluginViewFrame).mock.lastCall![0].suspended).toBe(false));
  });

  it('页面 URL 更新时保留展开分组并重建页面会话', async () => {
    render(<PluginSettingsViews {...props()} />);
    const first = await expand();
    const group = screen.getByRole('group', { name: '订阅设置' });
    const next = { ...view, url: '/plugins-ui/demo/editor/?revision=two' };
    act(() => setQueryData(QK.pluginViews('demo'), [next]));
    const updated = screen.getByTitle('订阅设置');
    expect(updated).not.toBe(first);
    expect(updated).toHaveAttribute('src', next.url);
    expect(screen.getByRole('group', { name: '订阅设置' })).toBe(group);
    expect(group).toHaveAttribute('open');
  });

  it('暂停时保留展开页面，恢复后继续使用同一会话', async () => {
    const value = props();
    const test = render(<PluginSettingsViews {...value} />);
    const frame = await expand();
    test.rerender(<PluginSettingsViews {...value} suspended />);
    expect(screen.getByTitle('订阅设置')).toBe(frame);
    expect(vi.mocked(PluginViewFrame).mock.lastCall![0].suspended).toBe(true);
    test.rerender(<PluginSettingsViews {...value} />);
    expect(screen.getByTitle('订阅设置')).toBe(frame);
    expect(vi.mocked(PluginViewFrame).mock.lastCall![0].suspended).toBe(false);
  });

  it('读取失败使用 InfoBar 与重试按钮，成功后展示设置分组', async () => {
    vi.mocked(api.pluginViews).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: '暂时无法读取页面',
      data: null,
    });
    render(<PluginSettingsViews {...props()} />);
    const retry = await screen.findByRole('button', { name: '重试读取' });
    expect(infoBar).toHaveBeenCalledWith({
      title: '插件设置读取失败',
      message: '暂时无法读取页面',
      tone: 'err',
    });
    expect(screen.queryByText('暂时无法读取页面')).not.toBeInTheDocument();
    await userEvent.click(retry);
    expect(await screen.findByText('订阅设置', { selector: 'summary' })).toBeVisible();
    expect(screen.getByTitle('订阅设置')).toBeVisible();
    expect(api.pluginAction).not.toHaveBeenCalled();
    expect(api.pluginConfigSave).not.toHaveBeenCalled();
  });

  it('服务端没有返回页面时不保留空分组', async () => {
    vi.mocked(api.pluginViews).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
      data: { ok: true, items: [] },
    });
    const { container } = render(<PluginSettingsViews {...props()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('其它分组首次展开才挂载，避免同时启动所有业务页面', async () => {
    const second = { ...view, id: 'history', title: '订阅历史', url: '/plugins-ui/demo/history/' };
    vi.mocked(api.pluginViews).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
      data: { ok: true, items: [view, second] },
    });
    render(<PluginSettingsViews {...props()} />);
    await screen.findByTitle('订阅设置');
    expect(screen.queryByTitle('订阅历史')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('订阅历史', { selector: 'summary' }));
    expect(await screen.findByTitle('订阅历史')).toBeVisible();
  });
});
