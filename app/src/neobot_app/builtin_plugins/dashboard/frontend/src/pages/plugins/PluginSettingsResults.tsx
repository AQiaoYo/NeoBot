import { Eye } from 'lucide-react';
import type { PluginAction, PluginSettingsGroup } from '../../api/types';
import { objectValue } from './pluginSettingsModel';
import { schemaProperty } from './pluginSettingsModel';
import PluginHtmlPreview from './PluginHtmlPreview';

export default function PluginSettingsResults({
  group,
  results,
  actions,
  kind = 'summary',
  actionIds,
  compact = false,
}: {
  group: PluginSettingsGroup;
  results: Record<string, unknown>;
  actions: PluginAction[];
  kind?: 'summary' | 'html';
  actionIds?: string[];
  compact?: boolean;
}) {
  return (
    <>
      {group.actions?.map((item) => {
        if (
          (item.display === 'html') !== (kind === 'html') ||
          (actionIds && !actionIds.includes(item.action))
        )
          return null;
        const ready = item.action in results;
        if (!ready && kind !== 'html') return null;
        const value = objectValue(results[item.action]);
        const title = item.label || actions.find((action) => action.id === item.action)?.title || '预览';
        const entries = Object.entries(value).filter(
          ([key, entry]) => typeof entry !== 'object' && !/url|html|token|cookie|secret|password/i.test(key),
        );
        const isAttention = ([key, entry]: (typeof entries)[number]) =>
          /error|fail/i.test(key) && entry !== false && entry !== 0 && entry !== '' && entry != null;
        const summaryEntries = entries.filter((entry, index) => index < 3 || isAttention(entry));
        const detailEntries = entries.filter((entry, index) => index >= 3 && !isAttention(entry));
        const renderEntries = (items: typeof entries) =>
          items.map(([key, entry]) => {
            const field = schemaProperty(
              actions.find((action) => action.id === item.action)?.output_schema ?? null,
              key,
            );
            return (
              <div key={key}>
                <dt>{typeof field === 'object' && field ? field.title || key : key}</dt>
                <dd>{typeof entry === 'boolean' ? (entry ? '是' : '否') : String(entry ?? '—')}</dd>
              </div>
            );
          });
        return kind === 'html' ? (
          <section key={item.action} className="plugin-settings-preview" aria-label={title}>
            <header className="plugin-settings-preview-heading">
              <div className="plugin-preview-title-group">
                <Eye size={15} className="plugin-preview-icon" aria-hidden="true" />
                <h4>{title}</h4>
              </div>
              <span className={`plugin-preview-badge ${ready ? 'ready' : 'empty'}`}>
                <span className="preview-status-dot" aria-hidden="true" />
                {ready ? '已生成' : '尚未预览'}
              </span>
            </header>
            {typeof value.html === 'string' ? (
              <PluginHtmlPreview
                html={value.html}
                title={title}
                width={typeof value.width === 'number' ? value.width : undefined}
                height={typeof value.height === 'number' ? value.height : undefined}
                fallbackText={typeof value.fallback_text === 'string' ? value.fallback_text : undefined}
              />
            ) : (
              <div className="plugin-settings-preview-empty">
                <div className="preview-mockup-card" aria-hidden="true">
                  <div className="mockup-banner">
                    <span className="mockup-badge">LIVE</span>
                  </div>
                  <div className="mockup-body">
                    <div className="mockup-avatar" />
                    <div className="mockup-lines">
                      <div className="mockup-line title" />
                      <div className="mockup-line subtitle" />
                    </div>
                  </div>
                </div>
                <div className="preview-empty-text">
                  <p>填写内容后，点击“{title}”</p>
                  <span>在这里确认最终效果</span>
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="plugin-settings-result-group" key={item.action}>
            <div className="plugin-result-header">
              <span className="plugin-result-tag">{item.label || '识别结果'}</span>
            </div>
            <dl className="plugin-settings-result" aria-label={item.label || '识别结果'}>
              {renderEntries(compact ? summaryEntries : entries)}
            </dl>
            {compact && detailEntries.length > 0 && (
              <details className="plugin-settings-result-details">
                <summary>查看完整状态</summary>
                <dl className="plugin-settings-result" aria-label={`${title}详情`}>
                  {renderEntries(detailEntries)}
                </dl>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
