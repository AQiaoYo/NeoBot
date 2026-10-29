import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PluginPonderStage from '../pages/plugins/PluginPonderStage';
import type { PluginGuide, PluginGuideStep } from '../api/types';
import type { PluginViewSurface } from '../pages/plugins/pluginViewBridge';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('短屏切章与异步内容增高后显示目标，只滚动思索内容，手动滚动保留用户位置', async () => {
  const observers: Array<{ callback: () => void; targets: Set<Element>; active: boolean }> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      record: (typeof observers)[number];
      constructor(callback: () => void) {
        this.record = { callback, targets: new Set(), active: true };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.add(target);
      }
      disconnect() {
        this.record.active = false;
      }
    },
  );

  let resourceHeight = 70;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  // jsdom 没有布局引擎；以内容坐标模拟短屏和真实 scrollTop 对目标屏幕位置的影响。
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.ponder-stage-viewport, .ponder-synthetic-stage'))
      return new DOMRect(10, 100, 320, 200);
    if (!this.hasAttribute('data-ponder-control')) return new DOMRect();
    const scroller = this.closest<HTMLElement>('.ponder-synthetic-stage');
    const submit = !!this.closest('.plugin-settings-buttons');
    const resource =
      this.matches('section[aria-label="记录列表"]') ||
      !!this.querySelector('section[aria-label="记录列表"]');
    const position = submit ? 520 : resource ? 820 : 20;
    return new DOMRect(20, 100 + position - (scroller?.scrollTop ?? 0), 280, resource ? resourceHeight : 40);
  });

  const initial: PluginGuideStep = { target: 'settings.board.name', text: '填写名称。' };
  const guide: PluginGuide = {
    id: 'first',
    title: '添加记录',
    steps: [initial],
    demo: { actions: { 'items.list': [{ id: 1, name: '演示任务' }] } },
  };
  const surface: PluginViewSurface = {
    available: true,
    source: 'runtime',
    state: 'loaded',
    permissions: ['read', 'manage'],
    contract: {
      schema_version: 1,
      plugin: { name: 'demo' },
      config: null,
      guides: [guide],
      actions: [
        {
          id: 'items.add',
          title: '添加记录',
          permission: 'manage',
          input_schema: { type: 'object', properties: { name: { type: 'string', title: '记录名称' } } },
          output_schema: null,
        },
        { id: 'items.list', title: '读取列表', permission: 'read', input_schema: null, output_schema: null },
      ],
      resources: [
        {
          id: 'items',
          title: '记录列表',
          list_action: 'items.list',
          columns: [{ key: 'name', title: '名称' }],
        },
      ],
      settings: [{ id: 'board', title: '待办清单', input_action: 'items.add', resource: 'items' }],
    },
  };
  const scene = (step: PluginGuideStep) => (
    <div className="workspace-scroll">
      <PluginPonderStage
        pluginId="demo"
        surface={surface}
        guide={guide}
        step={step}
        views={[]}
        reducedMotion
      />
    </div>
  );
  const rendered = render(scene(initial));
  await screen.findByText('演示任务');
  const workspace = rendered.container.querySelector<HTMLElement>('.workspace-scroll')!;
  const scroller = rendered.container.querySelector<HTMLElement>('.ponder-synthetic-stage')!;
  workspace.scrollTop = 37;
  expect(scroller.scrollTop).toBe(0);
  const targetVisible = () => {
    const target = scroller.querySelector<HTMLElement>('[data-ponder-control]')!.getBoundingClientRect();
    const area = scroller.getBoundingClientRect();
    expect(target.top).toBeGreaterThanOrEqual(area.top);
    expect(target.bottom).toBeLessThanOrEqual(area.bottom);
    expect(workspace.scrollTop).toBe(37);
    expect(document.documentElement.scrollTop).toBe(0);
  };

  await act(async () => rendered.rerender(scene({ target: 'settings.board.items.add', text: '提交记录。' })));
  expect(screen.getByRole('button', { name: '添加记录' })).toBeDisabled();
  expect(scroller.scrollTop).toBeGreaterThan(0);
  targetVisible();

  await act(async () => rendered.rerender(scene({ target: 'settings.board.resource', text: '查看结果。' })));
  targetVisible();
  const beforeGrowth = scroller.scrollTop;
  act(() => {
    resourceHeight = 120;
    const target = scroller.querySelector('[data-ponder-control]')!;
    observers
      .filter((observer) => observer.active && observer.targets.has(target))
      .forEach((observer) => observer.callback());
  });
  expect(scroller.scrollTop).toBeGreaterThan(beforeGrowth);
  targetVisible();

  scroller.scrollTop = 0;
  fireEvent.scroll(scroller);
  expect(scroller.scrollTop).toBe(0);
  expect(workspace.scrollTop).toBe(37);
});
