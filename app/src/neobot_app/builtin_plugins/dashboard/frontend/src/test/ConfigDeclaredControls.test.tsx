import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import SchemaForm from '../components/SchemaForm';
import type { FieldDescriptor, JsonSchema } from '../api/types';
import PluginConfigScene from '../pages/plugins/PluginConfigScene';
import { bindValues } from '../pages/config/shared';

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { name: 'setting', path: ['setting'], kind: 'scalar', type: 'str', value: '', ...overrides };
}

const delivery = field({
  name: 'delivery',
  label: '通知方式',
  path: ['delivery'],
  value: 'instant',
  default: 'instant',
  options: ['instant', 'digest'],
  options_strict: true,
  option_values: { instant: 'instant', digest: 'digest' },
  option_labels: { instant: '即时通知', digest: '汇总通知' },
});

describe('开发者声明的配置控件', () => {
  it('数字枚举显示声明的名称并回传数字，不把 Literal 数字变成字符串', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        fields={[
          field({
            label: '优先级',
            value: 1,
            options: ['1.0', '2'],
            options_strict: true,
            option_values: { '1.0': 1, '2': 2 },
          }),
        ]}
        onChange={onChange}
        showReloadSummary={false}
      />,
    );
    const control = screen.getByRole('combobox', { name: '优先级' });
    expect(control).toHaveValue('1.0');
    fireEvent.change(control, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(['setting'], 2);
  });

  it('布尔枚举按下拉展示，false 保留布尔类型', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        fields={[
          field({
            label: '处理方式',
            value: true,
            options: ['true', 'false'],
            options_strict: true,
            option_values: { true: true, false: false },
          }),
        ]}
        onChange={onChange}
        showReloadSummary={false}
      />,
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const control = screen.getByRole('combobox', { name: '处理方式' });
    expect(control).toHaveValue('true');
    fireEvent.change(control, { target: { value: 'false' } });
    expect(onChange).toHaveBeenCalledWith(['setting'], false);
  });

  it('嵌套分组沿用数值控件，并在修改时保留同组其他字段', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        fields={[
          field({
            name: 'connection',
            path: ['connection'],
            label: '连接设置',
            kind: 'group',
            value: { host: 'localhost', timeout: 10 },
            fields: [
              field({ name: 'host', path: ['connection', 'host'], label: '服务地址', value: 'localhost' }),
              field({
                name: 'timeout',
                path: ['connection', 'timeout'],
                label: '超时',
                type: 'int',
                value: 10,
                min: 1,
                max: 120,
              }),
            ],
          }),
        ]}
        onChange={onChange}
        showReloadSummary={false}
      />,
    );
    expect(screen.queryByDisplayValue('[object Object]')).not.toBeInTheDocument();
    const control = screen.getByRole('spinbutton', { name: /超时/ });
    expect(control).toHaveAttribute('min', '1');
    expect(control).toHaveAttribute('max', '120');
    fireEvent.change(control, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith(['connection'], { host: 'localhost', timeout: 30 });
  });

  it('字典和值为对象的字典分别使用键值编辑与结构化 JSON', () => {
    const simple = field({ name: 'weights', path: ['weights'], kind: 'dict', value: { primary: 2 } });
    const rendered = render(<SchemaForm fields={[simple]} onChange={vi.fn()} showReloadSummary={false} />);
    expect(screen.getByDisplayValue('primary')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    rendered.rerender(
      <SchemaForm
        fields={[{ ...simple, value: { primary: { weight: 2 } } }]}
        onChange={vi.fn()}
        showReloadSummary={false}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'weights' })).toHaveValue(
      JSON.stringify({ primary: { weight: 2 } }, null, 2),
    );
    expect(screen.queryByDisplayValue('[object Object]')).not.toBeInTheDocument();
  });

  it('对象列表直接编辑子字段，新增时使用字段默认值', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        fields={[
          field({
            name: 'routes',
            path: ['routes'],
            kind: 'model_list',
            value: [{ name: '已有连接' }],
            item_fields: [field({ name: 'name', path: ['routes', 'name'], default: '新连接' })],
            items: [
              {
                index: 0,
                fields: [field({ name: 'name', path: ['routes', '0', 'name'], value: '已有连接' })],
              },
            ],
          }),
        ]}
        onChange={onChange}
        showReloadSummary={false}
      />,
    );
    expect(screen.queryByText('元素里含对象/数组，只能用 JSON 编辑')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('已有连接'), { target: { value: '改名连接' } });
    expect(onChange).toHaveBeenCalledWith(['routes'], [{ name: '改名连接' }]);
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    expect(onChange).toHaveBeenLastCalledWith(['routes'], [{ name: '已有连接' }, { name: '新连接' }]);
  });

  it('对象列表草稿新增后立即出现新行，编辑和删除草稿不会继续显示读取时的旧行', () => {
    const template = field({
      name: 'routes',
      path: ['routes'],
      kind: 'model_list',
      value: [{ name: '旧快照' }],
      item_fields: [field({ name: 'name', path: ['routes', 'name'], label: '连接名称', default: '新连接' })],
      items: [
        {
          index: 0,
          fields: [
            field({ name: 'name', path: ['routes', '0', 'name'], label: '连接名称', value: '旧快照' }),
          ],
        },
      ],
    });
    function Editor() {
      const [routes, setRoutes] = useState([{ name: '草稿连接' }]);
      return (
        <>
          <SchemaForm
            fields={bindValues([template], { routes })}
            onChange={(_, next) => setRoutes(next)}
            showReloadSummary={false}
          />
          <button onClick={() => setRoutes([])}>清空草稿</button>
        </>
      );
    }
    render(<Editor />);
    expect(screen.getByDisplayValue('草稿连接')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('旧快照')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    const created = screen.getByDisplayValue('新连接');
    expect(created).toHaveAttribute('id', 'cfg-routes-1-name');
    fireEvent.change(created, { target: { value: '第二条连接' } });
    expect(screen.getByDisplayValue('第二条连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空草稿' }));
    expect(screen.queryByDisplayValue('草稿连接')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('第二条连接')).not.toBeInTheDocument();
    expect(template.value).toEqual([{ name: '旧快照' }]);
  });

  it('对象列表绑定保留嵌套参数的 provider 上下文及当前行路径', () => {
    const template = field({
      name: 'models',
      path: ['models'],
      kind: 'model_list',
      item_fields: [
        field({
          name: 'settings',
          path: ['models', 'settings'],
          kind: 'group',
          fields: [
            field({
              name: 'parameters',
              path: ['models', 'settings', 'parameters'],
              kind: 'model_params',
              catalog: [{ name: 'temperature' }],
            }),
          ],
        }),
      ],
    });
    const model = bindValues([template], {
      models: [
        {
          provider: 'example',
          model_type: 'chat',
          settings: { parameters: { enabled_params: ['temperature'], temperature: 0.7 } },
        },
      ],
    })[0];
    const parameters = model.items?.[0].fields[0].fields?.[0];
    expect(parameters?.path).toEqual(['models', '0', 'settings', 'parameters']);
    expect(parameters?.provider).toBe('example');
    expect(parameters?.model_type).toBe('chat');
    expect(parameters?.value).toEqual({
      enabled_params: ['temperature'],
      extra_body: {},
      values: { temperature: 0.7 },
    });
  });

  it.each([0, false, null, { nested: [1, 'one'] }, [1, 'one']])(
    'JSON 兜底保持原始值 %j 并拒绝无效 JSON',
    (value) => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          fields={[field({ kind: 'json', value })]}
          onChange={onChange}
          showReloadSummary={false}
        />,
      );
      const control = screen.getByRole('textbox', { name: 'setting' });
      expect(control).toHaveValue(JSON.stringify(value, null, 2));
      fireEvent.change(control, { target: { value: '{' } });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 JSON');
      fireEvent.change(control, { target: { value: 'false' } });
      expect(onChange).toHaveBeenCalledWith(['setting'], false);
    },
  );
});

describe('配置教程复用真实字段', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { delivery: { type: 'string', enum: ['instant', 'digest'], default: 'instant' } },
  };

  it('真实配置与思索使用同样的选项名称，教程仅替换样例值并禁用编辑', () => {
    const rendered = render(<SchemaForm fields={[delivery]} onChange={vi.fn()} showReloadSummary={false} />);
    expect(screen.getByRole('combobox', { name: '通知方式' })).toHaveValue('instant');
    expect(screen.getByRole('option', { name: '汇总通知' })).toHaveValue('digest');
    rendered.unmount();
    render(
      <PluginConfigScene
        pluginId="demo"
        schema={schema}
        fields={[delivery]}
        step={{ target: 'config.delivery', text: '选择通知方式。', example: { delivery: 'digest' } }}
      />,
    );
    const control = screen.getByRole('combobox', { name: '通知方式' });
    expect(control).toHaveValue('digest');
    expect(control).toBeDisabled();
    expect(screen.getByRole('option', { name: '汇总通知' })).toBeInTheDocument();
    expect(delivery.value).toBe('instant');
  });

  it('嵌套组只显示样例和公开默认值，不显示真实值或样例凭据', () => {
    const group = field({
      name: 'connection',
      path: ['connection'],
      kind: 'group',
      label: '连接设置',
      value: { host: 'private-live-host', key: '' },
      fields: [
        field({
          name: 'host',
          path: ['connection', 'host'],
          label: '服务地址',
          value: 'private-live-host',
          default: 'localhost',
        }),
        field({
          name: 'key',
          path: ['connection', 'key'],
          label: '访问密钥',
          value: '',
          default: '',
          sensitive: true,
        }),
      ],
    });
    render(
      <PluginConfigScene
        pluginId="demo"
        schema={{ type: 'object', properties: { connection: { type: 'object' } } }}
        fields={[group]}
        step={{
          target: 'config.connection',
          text: '填写连接。',
          example: { connection: { host: 'demo.test', key: 'private-demo-key' } },
        }}
      />,
    );
    expect(screen.getByDisplayValue('demo.test')).toBeDisabled();
    expect(screen.queryByDisplayValue('private-live-host')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('private-demo-key')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/访问密钥/)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/访问密钥/)).toHaveValue('');
  });

  it('对象列表示例重建行字段，不能复用真实行快照', () => {
    const rows = field({
      name: 'routes',
      path: ['routes'],
      kind: 'model_list',
      value: [{ name: 'private-live-row' }],
      item_fields: [field({ name: 'name', path: ['routes', 'name'], label: '连接名称', default: '新连接' })],
      items: [
        {
          index: 0,
          fields: [
            field({
              name: 'name',
              path: ['routes', '0', 'name'],
              label: '连接名称',
              value: 'private-live-row',
            }),
          ],
        },
      ],
    });
    const props = {
      pluginId: 'demo',
      schema: { type: 'object', properties: { routes: { type: 'array' } } } as JsonSchema,
      fields: [rows],
    };
    const rendered = render(
      <PluginConfigScene
        {...props}
        step={{ target: 'config.routes', text: '配置连接。', example: { routes: [{ name: '演示连接' }] } }}
      />,
    );
    expect(screen.getByDisplayValue('演示连接')).toBeDisabled();
    expect(screen.queryByDisplayValue('private-live-row')).not.toBeInTheDocument();
    rendered.rerender(
      <PluginConfigScene
        {...props}
        step={{ target: 'config.routes', text: '清空连接。', example: { routes: [] } }}
      />,
    );
    expect(screen.queryByDisplayValue('private-live-row')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('演示连接')).not.toBeInTheDocument();
    expect(screen.getByText('还没有配置项，点击「新增」添加')).toBeInTheDocument();
  });
});
