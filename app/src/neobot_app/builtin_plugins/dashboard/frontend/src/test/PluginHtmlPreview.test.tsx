import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginHtmlPreview from '../pages/plugins/PluginHtmlPreview';
import { PluginSettingsContent } from '../pages/plugins/PluginDeclaredSettings';
import { settingsFixture } from './PluginDeclaredSettings.fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function previewLayout(initialWidth: number) {
  let width = initialWidth;
  const observers: Array<{ callback: ResizeObserverCallback; active: boolean; targets: Set<Element> }> = [];
  // jsdom 不执行布局，仅补上容器实测宽度和尺寸变化通知。
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('plugin-settings-preview-canvas') ? width : 0;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private observer: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.observer = { callback, active: true, targets: new Set() };
        observers.push(this.observer);
      }
      observe(target: Element) {
        this.observer.targets.add(target);
      }
      disconnect() {
        this.observer.active = false;
      }
    },
  );
  return {
    resize(next: number) {
      width = next;
      act(() =>
        observers
          .filter((observer) => observer.active)
          .forEach((observer) =>
            observer.callback(
              [...observer.targets].map(
                (target) => ({ target, contentRect: new DOMRect(0, 0, width, 0) }) as ResizeObserverEntry,
              ),
              {} as ResizeObserver,
            ),
          ),
      );
    },
    activeObservers: () => observers.filter((observer) => observer.active).length,
  };
}

function paintedSize(frame: HTMLIFrameElement) {
  const scale = Number(/scale\(([^)]+)\)/.exec(frame.style.transform)?.[1] ?? '1');
  return {
    width: parseFloat(frame.style.width) * scale,
    height: parseFloat(frame.style.height) * scale,
    scale,
  };
}

describe('隔离 HTML 预览', () => {
  it('声明单行文本时使用 input，中文组字和外部重排不会丢失输入或占位提示', async () => {
    const test = settingsFixture();
    const group = {
      ...test.group,
      fields: [
        ...(test.group.fields ?? []),
        { name: 'target', control: 'text' as const, placeholder: '粘贴直播间链接' },
      ],
    };
    const user = userEvent.setup();
    const rendered = render(<PluginSettingsContent {...test} group={group} />);
    const input = screen.getByRole('textbox', { name: '直播间链接' });
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('placeholder', '粘贴直播间链接');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'zhong' } });
    rendered.rerender(
      <PluginSettingsContent {...test} group={{ ...group, description: '布局更新后的说明' }} />,
    );
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toBe(input);
    expect(input).toHaveValue('zhong');
    expect(screen.getByRole('button', { name: '识别直播间' })).toBeDisabled();
    fireEvent.compositionEnd(input, { target: { value: '中文直播间' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '识别直播间' })).toBeEnabled());
    expect(input).toHaveValue('中文直播间');
    await user.click(screen.getByRole('button', { name: '识别直播间' }));
    expect(test.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'subscriptions.resolve' }),
      { target: '中文直播间' },
      true,
    );
  });

  it('窄容器能看完整预览，查看原图后可以返回适应窗口，尺寸变化不重新创建文档', async () => {
    const layout = previewLayout(360);
    const user = userEvent.setup();
    render(<PluginHtmlPreview title="通知卡片" html="<p>合成卡片内容</p>" width={960} height={600} />);
    const frame = screen.getByTitle<HTMLIFrameElement>('通知卡片');
    expect(paintedSize(frame).width).toBeLessThanOrEqual(360);
    expect(paintedSize(frame).scale).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '查看原始大小' }));
    expect(paintedSize(frame).width).toBe(960);
    layout.resize(280);
    await user.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(paintedSize(frame).width).toBeLessThanOrEqual(280);
    expect(screen.getByTitle('通知卡片')).toBe(frame);
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('合成卡片内容'));
  });

  it('原图切换、缩放和新内容不会扩大 iframe 权限或暴露宿主来源', async () => {
    const layout = previewLayout(420);
    const user = userEvent.setup();
    const rendered = render(<PluginHtmlPreview title="通知卡片" html="<p>第一张卡片</p>" />);
    await user.click(screen.getByRole('button', { name: '查看原始大小' }));
    layout.resize(280);
    rendered.rerender(
      <PluginHtmlPreview title="通知卡片" html="<p>第二张卡片</p>" width={800} height={500} />,
    );
    const frame = screen.getByTitle('通知卡片');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    const source = frame.getAttribute('srcdoc')!;
    expect(source).toContain("default-src 'none'");
    expect(source).not.toContain('allow-scripts');
    expect(source).toContain('第二张卡片');
  });

  it('明确声明短文档时不沿用默认长画布，特殊尺寸也保持有限且可适应的绘制范围', () => {
    previewLayout(600);
    const rendered = render(
      <PluginHtmlPreview title="通知卡片" html="<p>一行通知</p>" width={480} height={140} />,
    );
    const frame = screen.getByTitle<HTMLIFrameElement>('通知卡片');
    expect(paintedSize(frame).height).toBeLessThanOrEqual(140);
    expect(paintedSize(frame).width).toBeLessThanOrEqual(600);
    rendered.rerender(
      <PluginHtmlPreview title="通知卡片" html="<p>一行通知</p>" width={Number.NaN} height={0} />,
    );
    const size = paintedSize(frame);
    expect(Number.isFinite(size.width)).toBe(true);
    expect(Number.isFinite(size.height)).toBe(true);
    expect(size.scale).toBeGreaterThan(0);
    expect(size.width).toBeLessThanOrEqual(600);
  });

  it('打开预览和原图不会清除仍未提交的业务输入，卸载后释放尺寸观察', async () => {
    const layout = previewLayout(420);
    const test = settingsFixture();
    const user = userEvent.setup();
    const rendered = render(<PluginSettingsContent {...test} />);
    await screen.findByRole('option', { name: '测试接收群' });
    await user.selectOptions(screen.getByRole('combobox', { name: '接收群' }), '42');
    const input = screen.getByRole('textbox', { name: '直播间链接' });
    await user.type(input, 'https://live.bilibili.com/101');
    await user.click(screen.getByRole('button', { name: '预览通知' }));
    await screen.findByTitle('预览通知');
    await user.click(screen.getByRole('button', { name: '查看原始大小' }));
    layout.resize(280);
    await user.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(screen.getByRole('textbox', { name: '直播间链接' })).toBe(input);
    expect(input).toHaveValue('https://live.bilibili.com/101');
    expect(screen.getByRole('combobox', { name: '接收群' })).toHaveValue('42');
    expect(screen.getByRole('button', { name: '开始监听' })).toBeEnabled();
    const textToggle = screen.getByRole('button', { name: '查看文字内容' });
    expect(textToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(textToggle);
    expect(screen.getByRole('button', { name: '收起文字内容' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('合成通知文字')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '收起文字内容' }));
    expect(screen.queryByText('合成通知文字')).not.toBeInTheDocument();
    expect(test.run.mock.calls.every(([definition]) => definition.permission === 'read')).toBe(true);
    expect(layout.activeObservers()).toBeGreaterThan(0);
    rendered.unmount();
    expect(layout.activeObservers()).toBe(0);
  });
});
