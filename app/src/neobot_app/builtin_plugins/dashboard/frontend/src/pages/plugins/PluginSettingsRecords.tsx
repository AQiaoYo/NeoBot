import { useState } from 'react';
import type { PluginAction, PluginResource, PluginSettingsGroup } from '../../api/types';
import Button from '../../components/ui/Button';
import { confirmAction } from '../../components/ui/ConfirmDialog';
import { actionInput, schemaProperty } from './pluginSettingsModel';

interface Props {
  group: PluginSettingsGroup;
  resource: PluginResource;
  rows: Record<string, unknown>[];
  actions: PluginAction[];
  disabled: boolean;
  permissions: string[];
  execute: (action: PluginAction, input: Record<string, unknown>) => Promise<boolean>;
  hideHeading?: boolean;
}

function RecordRow({ row, ...props }: Props & { row: Record<string, unknown> }) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const edit = props.actions.find((item) => item.id === props.group.edit_action);
  const remove = props.actions.find((item) => item.id === props.resource.delete_action);
  const locked = props.disabled;
  return (
    <li className="plugin-settings-record">
      <dl>
        {props.resource.columns
          .filter((column) => !props.group.switch_fields?.includes(column.key))
          .map((column) => (
            <div key={column.key}>
              <dt>{column.title}</dt>
              <dd>{String(row[column.key] ?? '—')}</dd>
            </div>
          ))}
      </dl>
      <div className="plugin-settings-record-actions">
        {edit &&
          props.group.switch_fields?.map((key) => {
            const schema = schemaProperty(edit.input_schema, key);
            const title = typeof schema === 'object' && schema ? schema.title || key : key;
            return (
              <label key={key} className="config-switch">
                <input
                  type="checkbox"
                  checked={Boolean(draft[key] ?? row[key])}
                  disabled={locked || !props.permissions.includes(edit.permission)}
                  onChange={(event) => setDraft((before) => ({ ...before, [key]: event.target.checked }))}
                />
                <span className="switch-track" />
                <span>{title}</span>
              </label>
            );
          })}
        {edit && Object.keys(draft).length > 0 && (
          <Button
            size="sm"
            disabled={locked || !props.permissions.includes(edit.permission)}
            onClick={async () => {
              if (await props.execute(edit, { ...row, ...draft })) setDraft({});
            }}
          >
            保存推送设置
          </Button>
        )}
        {remove && (
          <Button
            size="sm"
            variant="ghost"
            disabled={locked || !props.permissions.includes(remove.permission)}
            onClick={async () => {
              if (
                await confirmAction({
                  title: `${remove.title}？`,
                  description: '此操作立即生效。',
                  confirmLabel: remove.title,
                  danger: true,
                })
              )
                await props.execute(remove, row);
            }}
          >
            {remove.title}
          </Button>
        )}
      </div>
    </li>
  );
}

export default function PluginSettingsRecords(props: Props) {
  const identityAction = props.actions.find(
    (item) => item.id === (props.resource.delete_action || props.group.edit_action),
  );
  const rowKey = (row: Record<string, unknown>, index: number) =>
    identityAction
      ? JSON.stringify(
          Object.entries(actionInput(identityAction, row)).filter(
            ([key]) => !props.group.switch_fields?.includes(key),
          ),
        )
      : `${JSON.stringify(row)}:${index}`;
  return (
    <div>
      {!props.hideHeading && <h3>{props.resource.title}</h3>}
      {props.rows.length ? (
        <ul className="plugin-settings-records">
          {props.rows.map((row, index) => (
            <RecordRow key={rowKey(row, index)} {...props} row={row} />
          ))}
        </ul>
      ) : (
        <p className="empty muted">暂无记录，填写上方内容后即可添加。</p>
      )}
    </div>
  );
}
