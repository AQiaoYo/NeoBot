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

describe('插件页面中的独立页面分组', () => {
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

  it('页面 URL 更新时保留页面区域并重建会话', async () => {
    render(<PluginSettingsViews {...props()} />);
    const first = await screen.findByTitle('订阅设置');
    const group = screen.getByRole('region', { name: '订阅设置' });
    const next = { ...view, url: '/plugins-ui/demo/editor/?revision=two' };
    act(() => setQueryData(QK.pluginViews('demo'), [next]));
    const updated = screen.getByTitle('订阅设置');
    expect(updated).not.toBe(first);
    expect(updated).toHaveAttribute('src', next.url);
    expect(screen.getByRole('region', { name: '订阅设置' })).toBe(group);
  });

  it('暂停时保留展开页面，恢复后继续使用同一会话', async () => {
    const value = props();
    const test = render(<PluginSettingsViews {...value} />);
    const frame = await screen.findByTitle('订阅设置');
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
      title: '插件页面读取失败',
      message: '暂时无法读取页面',
      tone: 'err',
    });
    expect(screen.queryByText('暂时无法读取页面')).not.toBeInTheDocument();
    await userEvent.click(retry);
    expect(await screen.findByRole('region', { name: '订阅设置' })).toBeVisible();
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

  it('独立页面直接展示所有已声明页面，不再用收起来阻挡功能入口', async () => {
    const second = { ...view, id: 'history', title: '订阅历史', url: '/plugins-ui/demo/history/' };
    vi.mocked(api.pluginViews).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
      data: { ok: true, items: [view, second] },
    });
    render(<PluginSettingsViews {...props()} />);
    await screen.findByTitle('订阅设置');
    expect(await screen.findByTitle('订阅历史')).toBeVisible();
  });
});
