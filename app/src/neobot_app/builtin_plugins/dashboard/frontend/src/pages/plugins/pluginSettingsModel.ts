import type { FieldDescriptor, JsonSchema, PluginAction, PluginSettingsGroup } from '../../api/types';
import { getPath } from '../../utils/paths';
import { actionFields, resolveSchema } from './pluginActionSchema';

export function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function atPath(value: unknown, path: string): unknown {
  return path ? getPath(value, path.split('.')) : value;
}

export function actionInput(action: PluginAction, values: Record<string, unknown>): Record<string, unknown> {
  const schema =
    action.input_schema && typeof action.input_schema === 'object'
      ? resolveSchema(action.input_schema, action.input_schema)
      : action.input_schema;
  if (!schema || typeof schema !== 'object') return {};
  return Object.fromEntries(
    Object.keys(schema.properties ?? {})
      .filter((key) => values[key] !== undefined && !(values[key] === '' && !schema.required?.includes(key)))
      .map((key) => [key, values[key]]),
  );
}

export function inputReady(action: PluginAction, values: Record<string, unknown>): boolean {
  const schema =
    action.input_schema && typeof action.input_schema === 'object'
      ? resolveSchema(action.input_schema, action.input_schema)
      : action.input_schema;
  return (
    !schema ||
    typeof schema !== 'object' ||
    (schema.required ?? []).every(
      (key) => values[key] !== undefined && values[key] !== null && values[key] !== '',
    )
  );
}

export function settingFields(
  action: PluginAction,
  group: PluginSettingsGroup,
  values: Record<string, unknown>,
  options: Record<string, unknown>,
): FieldDescriptor[] {
  const root = action.input_schema;
  if (!root || typeof root !== 'object') return [];
  const schema = resolveSchema(root, root);
  if (typeof schema !== 'object') return [];
  const properties = schema.properties ?? {};
  // UI 声明只决定顺序和提示；遗漏字段仍追加，避免意外隐藏必填业务参数。
  const names = [
    ...new Set([...(group.fields ?? []).map((field) => field.name), ...Object.keys(properties)]),
  ].filter((name) => Object.hasOwn(properties, name));
  const fields = names.map((name): FieldDescriptor => {
    const declared = resolveSchema(properties[name], root);
    const mapped = actionFields({ type: 'object', properties: { [name]: declared } }, values)?.[0];
    if (mapped) return mapped;
    // 单个复杂字段交给已有 JSON 编辑器，不能让它拖累同组标量或字符串化对象。
    const field = typeof declared === 'object' ? declared : {};
    return {
      name: field.title || name,
      path: [name],
      kind: 'json',
      type: 'any',
      value: values[name],
      default: field.default,
      description: field.description,
      readonly: field.readOnly === true,
    };
  });
  return fields.map((field) => {
    const hint = group.fields?.find((item) => item.name === field.path[0]);
    const source = hint?.options;
    const rows = source ? atPath(options[field.path[0]], source.items) : undefined;
    const choices = Array.isArray(rows) ? rows : [];
    const optionValues: NonNullable<FieldDescriptor['option_values']> = { '': '' };
    const labels: Record<string, string> = { '': '请选择' };
    for (const item of choices) {
      const raw = atPath(item, source!.value);
      if (!['string', 'number', 'boolean'].includes(typeof raw)) continue;
      const key = String(raw);
      optionValues[key] = raw as string | number | boolean;
      labels[key] = String(atPath(item, source!.label) ?? raw);
    }
    return {
      ...field,
      name: field.path[0],
      label: field.name,
      description: hint?.description || field.description,
      placeholder: hint?.placeholder,
      single_line: hint?.control === 'text',
      input_id: `settings-${group.id}-${field.path[0]}`,
      ...(source
        ? {
            options: Object.keys(labels),
            option_labels: labels,
            option_values: optionValues,
            options_strict: true,
          }
        : {}),
    };
  });
}

export function schemaProperty(schema: JsonSchema | null, key: string): JsonSchema | null {
  if (!schema || typeof schema !== 'object') return null;
  const root = resolveSchema(schema, schema);
  return typeof root === 'object' ? resolveSchema(root.properties?.[key] ?? false, schema) : null;
}
