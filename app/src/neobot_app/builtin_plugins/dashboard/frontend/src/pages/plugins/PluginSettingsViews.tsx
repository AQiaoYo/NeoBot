import { useEffect, useState } from 'react';
import type { PluginView } from '../../api/types';
import Button from '../../components/ui/Button';
import Icon from '../../components/Icon';
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
  initiallyOpen,
  ...props
}: Props & { view: PluginView & { url: string }; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [visited, setVisited] = useState(initiallyOpen && !props.suspended);
  useEffect(() => {
    // 首次配置尚未就绪时不启动页面；之后暂停或收起只停请求，不销毁输入。
    if (open && !props.suspended) setVisited(true);
  }, [open, props.suspended]);
  return (
    <details
      className="plugin-settings-view"
      aria-label={view.title}
      open={open}
      onToggle={(event) => {
        const expanded = event.currentTarget.open;
        setOpen(expanded);
      }}
    >
      <summary>
        <Icon name="chevron" size={16} />
        {view.title}
      </summary>
      {visited && (
        <div className="plugin-settings-frame-wrap">
          <PluginViewFrame
            key={view.url}
            {...props}
            view={view}
            mode="live"
            layout="inline"
            suspended={props.suspended || !open}
          />
        </div>
      )}
    </details>
  );
}

export default function PluginSettingsViews(props: Props) {
  const declared = !!props.surface.contract.views?.length;
  const query = usePluginViews(props.pluginId, declared);
  useQueryErrorNotice(query.error, query.updatedAt, '插件设置读取失败', declared);

  if (!declared || (!query.loading && !query.error && !query.data?.length)) return null;
  return (
    <div className="plugin-settings-views">
      {query.loading && !query.data ? (
        <PanelSkeleton label="正在读取插件设置…" rows={2} />
      ) : (
        query.data?.map((view, index) => (
          <SettingsView
            key={`${props.pluginId}:${view.id}`}
            {...props}
            view={view}
            initiallyOpen={index === 0}
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
