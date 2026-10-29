import { useEffect, useState } from 'react';
import type { PluginView } from '../../api/types';
import Button from '../../components/ui/Button';
import { PanelSkeleton } from '../../components/ui/PageSkeleton';
import { useQueryErrorNotice } from '../../hooks/useQueryErrorNotice';
import PluginViewFrame from './PluginViewFrame';
import type { PluginViewConfigAccess, PluginViewSurface, RunPluginAction } from './pluginViewBridge';
import { usePluginViews } from './usePluginViews';

interface Props {
  pluginId: string;
  surface: PluginViewSurface;
  run: RunPluginAction;
  configAccess: PluginViewConfigAccess;
  suspended: boolean;
  onNavigate: (target: string) => void;
}

function SettingsView({
  view,
  showHeading,
  ...props
}: Props & { view: PluginView & { url: string }; showHeading: boolean }) {
  const [visited, setVisited] = useState(!props.suspended);
  useEffect(() => {
    // 独立页面只延后首次挂载；切换顶层页签时暂停请求并保留输入。
    if (!props.suspended) setVisited(true);
  }, [props.suspended]);
  return (
    <section className="plugin-settings-view" aria-label={view.title}>
      {showHeading && <h3>{view.title}</h3>}
      {visited && (
        <div className="plugin-settings-frame-wrap">
          <PluginViewFrame
            key={view.url}
            {...props}
            view={view}
            mode="live"
            layout="inline"
            suspended={props.suspended}
          />
        </div>
      )}
    </section>
  );
}

export default function PluginSettingsViews(props: Props) {
  const declared = !!props.surface.contract.views?.length;
  const query = usePluginViews(props.pluginId, declared);
  useQueryErrorNotice(query.error, query.updatedAt, '插件页面读取失败', declared);

  if (!declared || (!query.loading && !query.error && !query.data?.length)) return null;
  return (
    <div className="plugin-settings-views">
      {query.loading && !query.data ? (
        <PanelSkeleton label="正在读取插件页面…" rows={2} />
      ) : (
        query.data?.map((view) => (
          <SettingsView
            key={`${props.pluginId}:${view.id}`}
            {...props}
            view={view}
            showHeading={(query.data?.length ?? 0) > 1}
          />
        ))
      )}
      {query.error && (
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
          重试读取
        </Button>
      )}
    </div>
  );
}
