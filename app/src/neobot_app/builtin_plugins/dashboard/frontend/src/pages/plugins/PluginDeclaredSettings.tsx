import { useState } from 'react';
import type { PluginSettingsGroup } from '../../api/types';
import SchemaForm from '../../components/SchemaForm';
import Button from '../../components/ui/Button';
import Icon from '../../components/Icon';
import { Activity, Plus, Search, Eye, AlertCircle, RefreshCw, Radio } from 'lucide-react';
import { inputReady, settingFields } from './pluginSettingsModel';
import { usePluginSettings, type SettingsOptions } from './usePluginSettings';
import PluginSettingsResults from './PluginSettingsResults';
import PluginSettingsRecords from './PluginSettingsRecords';

export function PluginSettingsContent(props: SettingsOptions) {
  const { surface, group, suspended, step } = props;
  const state = usePluginSettings(props);
  const fields = settingFields(state.action, group, state.values, state.choices).map((field) =>
    step ? { ...field, input_id: `ponder-${field.input_id}` } : field,
  );
  const locked = !!suspended || !!state.pending || !surface.available || !!step;
  const prefix = `settings.${group.id}.`;
  const target = step?.target.slice(prefix.length);
  const permission = (name: string) => surface.contract.actions.find((item) => item.id === name);
  const fieldsReady = inputReady(state.action, state.values);
  const canSubmit =
    !locked &&
    fieldsReady &&
    surface.permissions.includes(state.action.permission) &&
    (!group.require_action || group.require_action in state.results);
  const toolbar = (group.actions ?? []).filter((item) => {
    const action = permission(item.action);
    return state.resource && item.display !== 'html' && action && inputReady(action, {});
  });
  const workflow = (group.actions ?? []).filter((item) => !toolbar.includes(item));
  const hasPreview = workflow.some((item) => item.display === 'html');
  const getActionIcon = (actionId: string, label: string) => {
    if (actionId.includes('resolve') || label.includes('识别')) return <Search size={14} aria-hidden="true" />;
    if (actionId.includes('preview') || label.includes('预览')) return <Eye size={14} aria-hidden="true" />;
    if (actionId.includes('health') || label.includes('刷新'))
      return <RefreshCw size={13} className={state.pending === actionId ? 'spin' : ''} aria-hidden="true" />;
    return null;
  };
  const actionButton = (item: NonNullable<PluginSettingsGroup['actions']>[number], compact = false) => {
    const action = permission(item.action);
    if (!action) return null;
    const label = item.label || action.title;
    const icon = getActionIcon(item.action, label);
    return (
      <span key={item.action} data-ponder-control={target === item.action ? '' : undefined}>
        <Button
          size={compact ? 'sm' : 'md'}
          variant={compact ? 'ghost' : 'default'}
          disabled={
            locked || !inputReady(action, state.values) || !surface.permissions.includes(action.permission)
          }
          onClick={() => void state.execute(action)}
        >
          {compact && (icon || <Activity size={14} aria-hidden="true" />)}
          {!compact && icon}
          <span>{state.pending === action.id ? '处理中…' : label}</span>
        </Button>
      </span>
    );
  };
  return (
    <div
      className={
        'plugin-declared-content' +
        (hasPreview ? ' has-preview' : '') +
        (state.resource ? ' has-records' : '')
      }
      data-ponder-control={step?.target === `settings.${group.id}` ? '' : undefined}
    >
      <div className="plugin-settings-form">
        <div className="plugin-settings-fields">
          {fields.map((field) => (
            <div key={field.name} data-ponder-control={target === field.name ? '' : undefined}>
              <SchemaForm
                fields={[field]}
                values={state.values}
                disabled={locked}
                showReloadSummary={false}
                onChange={(path, value) => state.change(path[0], value)}
              />
            </div>
          ))}
        </div>
        <div className="plugin-settings-buttons">
          {workflow.map((item) => actionButton(item))}
          <span
            className="plugin-settings-submit"
            data-ponder-control={target === state.action.id ? '' : undefined}
          >
            <Button variant="primary" disabled={!canSubmit} onClick={() => void state.execute(state.action)}>
              {state.resource?.create_action === state.action.id && <Plus size={16} />}
              {state.pending === state.action.id ? '处理中…' : group.submit_label || state.action.title}
            </Button>
          </span>
        </div>
        <PluginSettingsResults
          group={group}
          results={state.results}
          actions={surface.contract.actions}
          actionIds={workflow.map((item) => item.action)}
        />
        {state.error && (
          <div role="alert" className="plugin-settings-error">
            <div className="plugin-settings-error-content">
              <AlertCircle size={16} className="plugin-settings-error-icon" aria-hidden="true" />
              <p>{state.error}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => void state.refresh()}>
              <RefreshCw size={13} aria-hidden="true" />
              重试读取
            </Button>
          </div>
        )}
      </div>
      {hasPreview && (
        <aside className="plugin-settings-preview-column">
          <PluginSettingsResults
            group={group}
            results={state.results}
            actions={surface.contract.actions}
            kind="html"
          />
        </aside>
      )}
      {state.resource && (
        <section
          className="plugin-settings-record-section"
          aria-label={state.resource.title}
          data-ponder-control={target === 'resource' ? '' : undefined}
        >
          <header className="plugin-settings-list-heading">
            <h3>
              {state.resource.title}
              <span>{state.rows?.length ?? '—'}</span>
            </h3>
            <div>{toolbar.map((item) => actionButton(item, true))}</div>
          </header>
          <PluginSettingsResults
            group={group}
            results={state.results}
            actions={surface.contract.actions}
            actionIds={toolbar.map((item) => item.action)}
            compact
          />
          {state.rows === null ? (
            <p className="muted">正在读取列表…</p>
          ) : (
            <PluginSettingsRecords
              group={group}
              resource={state.resource}
              rows={state.rows}
              actions={surface.contract.actions}
              disabled={locked}
              permissions={surface.permissions}
              execute={state.execute}
              hideHeading
            />
          )}
        </section>
      )}
    </div>
  );
}

function SettingsSection(props: SettingsOptions) {
  const [open, setOpen] = useState(!props.group.collapsed);
  const [visited, setVisited] = useState(open);
  if (!props.group.collapsed)
    return (
      <section className="plugin-declared-settings" aria-label={props.group.title}>
        <header className="plugin-declared-settings-header">
          <div className="plugin-declared-settings-title-row">
            <div className="plugin-declared-title-badge" aria-hidden="true">
              <Radio size={16} />
            </div>
            <h3>{props.group.title}</h3>
            <span className="plugin-live-badge">实时生效</span>
          </div>
          {props.group.description && <p className="plugin-declared-desc muted">{props.group.description}</p>}
        </header>
        <PluginSettingsContent {...props} />
      </section>
    );
  return (
    <details
      className="plugin-declared-settings"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        <Icon name="chevron" size={16} />
        {props.group.title}
        <span className="plugin-live-badge">实时生效</span>
      </summary>
      {props.group.description && <p className="plugin-declared-desc muted">{props.group.description}</p>}
      {visited && <PluginSettingsContent {...props} suspended={props.suspended || !open} />}
    </details>
  );
}

export default function PluginDeclaredSettings(props: Omit<SettingsOptions, 'group'>) {
  return (
    <>
      {props.surface.contract.settings?.map((group: PluginSettingsGroup) => (
        <SettingsSection key={group.id} {...props} group={group} />
      ))}
    </>
  );
}
