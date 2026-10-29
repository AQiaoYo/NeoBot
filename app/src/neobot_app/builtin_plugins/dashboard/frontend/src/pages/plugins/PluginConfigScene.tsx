import type { FieldDescriptor, JsonSchema, PluginGuideStep } from '../../api/types';
import SchemaForm from '../../components/SchemaForm';
import { getPath, setPath } from '../../utils/paths';
import { actionFields, initialActionInput, resolveSchema } from './pluginActionSchema';
import { rebaseFieldPaths } from '../config/shared';

interface Props {
  pluginId: string;
  schema: JsonSchema | null;
  step: PluginGuideStep;
  fields?: FieldDescriptor[];
}

function findField(fields: FieldDescriptor[], path: string): FieldDescriptor | undefined {
  for (const field of fields) {
    if (field.path.join('.') === path) return field;
    const nested = findField(field.fields ?? [], path);
    if (nested) return nested;
  }
}

function sampleField(field: FieldDescriptor, sample: unknown): FieldDescriptor {
  const value = field.sensitive ? '' : sample === undefined ? field.default : sample;
  const descriptor: FieldDescriptor = {
    ...field,
    value,
    input_id: `ponder-config-${field.path.map(encodeURIComponent).join('-')}`,
  };
  if (field.sensitive) return descriptor;
  if (field.kind === 'group') {
    descriptor.fields = field.fields?.map((child) =>
      sampleField(child, getPath(value, child.path.slice(field.path.length))),
    );
    descriptor.value = Object.fromEntries(
      (descriptor.fields ?? []).map((child) => [child.name, child.value]),
    );
  }
  if (field.kind === 'model_list') {
    const template = field.item_fields ?? field.items?.[0]?.fields ?? [];
    const previous = field.item_fields ? field.path : [...field.path, '0'];
    const rows = Array.isArray(value) ? value : [];
    descriptor.item_fields = template.map((child) => sampleField(child, undefined));
    descriptor.items = rows.map((row, index) => {
      const rowPath = [...field.path, String(index)];
      const fields = rebaseFieldPaths(template, previous, rowPath).map((child) =>
        sampleField(child, getPath(row, child.path.slice(rowPath.length))),
      );
      return { index, fields };
    });
    descriptor.value = descriptor.items.map((item) =>
      Object.fromEntries(item.fields.map((child) => [child.name, child.value])),
    );
  }
  return descriptor;
}

function fieldSchema(root: JsonSchema | null, path: string[]): JsonSchema | null {
  if (root === null) return null;
  let field: JsonSchema = root;
  for (const key of path) {
    const parent = resolveSchema(field, root);
    if (typeof parent !== 'object' || !parent.properties?.[key]) return null;
    field = parent.properties[key];
  }
  return resolveSchema(field, root);
}

export default function PluginConfigScene({ pluginId, schema, step, fields: liveFields }: Props) {
  const path = step.target.slice('config.'.length).split('.');
  const name = path.at(-1)!;
  const field = fieldSchema(schema, path);
  const declared = getPath(step.example, path);
  const sample = declared !== undefined ? declared : (step.example?.[name] ?? initialActionInput(field));
  const live = findField(liveFields ?? [], path.join('.'));
  const fields =
    field === null
      ? null
      : actionFields({ type: 'object', properties: { [name]: field } }, { [name]: sample });
  const descriptor = live ? sampleField(live, sample) : fields?.[0];
  const sensitive = descriptor?.sensitive === true;
  if (descriptor) {
    // 名称、路径和控件沿用实际配置表单；演示ID独立，避免覆盖底层编辑器标签。
    descriptor.label = descriptor.label || descriptor.name;
    descriptor.name = name;
    descriptor.path = path;
    descriptor.input_id = `ponder-config-${path.map(encodeURIComponent).join('-')}`;
    if (sensitive) descriptor.value = '';
  }
  const values = setPath({}, path, descriptor?.value ?? sample);
  return (
    <div className="ponder-synthetic-stage ponder-config-scene">
      <div className="ponder-stage-heading">
        <span>配置表单</span>
        <span>样例</span>
      </div>
      <div className="ponder-config-content">
        <p className="ponder-config-path">插件管理 / {pluginId} / 配置表单</p>
        <div data-ponder-control>
          {descriptor ? (
            <SchemaForm
              fields={[descriptor]}
              values={values}
              disabled
              onChange={() => {}}
              showReloadSummary={false}
            />
          ) : (
            <div className="ponder-config-value">
              <code>{path.join('.')}</code>
              <pre>{JSON.stringify(sample, null, 2)}</pre>
            </div>
          )}
        </div>
        {sensitive && <p>在真实配置中填写，说明书不展示凭据。</p>}
      </div>
    </div>
  );
}
