import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginAction, PluginGuideDemo, PluginGuideStep, PluginSettingsGroup } from '../../api/types';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { infoBar } from '../../notifications/infoBar';
import { initialActionValues } from './pluginActionSchema';
import { actionInput, atPath, inputReady, objectValue } from './pluginSettingsModel';
import type { PluginViewSurface, RunPluginAction } from './pluginViewBridge';

export interface SettingsOptions {
  surface: PluginViewSurface;
  group: PluginSettingsGroup;
  run: RunPluginAction;
  suspended?: boolean;
  demo?: PluginGuideDemo;
  step?: PluginGuideStep;
}

/** 声明式页面只有一份临时输入；后台刷新仅替换列表，不覆盖输入或禁用焦点控件。 */
export function usePluginSettings(options: SettingsOptions) {
  const { surface, group, step, demo } = options;
  const action = surface.contract.actions.find((item) => item.id === group.input_action)!;
  const resource = surface.contract.resources.find((item) => item.id === group.resource);
  const [values, setValues] = useState(() => initialActionValues(action.input_schema));
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [choices, setChoices] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(resource ? null : []);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const epoch = useRef(0);
  const reads = useRef(0);
  const latest = useRef({ options, values });
  latest.current = { options, values };
  const alive = useRef(true);
  const invalidate = useCallback(() => {
    epoch.current++;
    reads.current++;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    epoch.current++;
    reads.current++;
  }, [options.suspended]);

  const call = async (definition: PluginAction, input: Record<string, unknown>): Promise<unknown> => {
    const current = latest.current.options;
    if (current.step) {
      if (!current.demo?.actions || !(definition.id in current.demo.actions))
        throw new Error('说明书缺少此操作的样例数据');
      return structuredClone(current.demo.actions[definition.id]);
    }
    if (current.suspended || !current.surface.available) throw new Error('当前操作已暂停');
    if (!current.surface.permissions.includes(definition.permission))
      throw new Error('当前没有执行此操作的权限');
    const response = await current.run(definition, actionInput(definition, input), true);
    if (!response?.ok) throw new Error(response?.error || '操作未完成，请稍后重试');
    return response.result;
  };

  const refresh = async () => {
    const current = latest.current;
    if (
      !current.options.step &&
      (current.options.suspended || !current.options.surface.available || busy.current)
    )
      return;
    const version = epoch.current;
    const request = ++reads.current;
    try {
      const data = await Promise.all(
        (group.fields ?? [])
          .filter((field) => field.options)
          .map(async (field) => {
            const definition = surface.contract.actions.find((item) => item.id === field.options!.action)!;
            return [
              field.name,
              inputReady(definition, current.values) ? await call(definition, current.values) : null,
            ] as const;
          }),
      );
      const listing = resource && surface.contract.actions.find((item) => item.id === resource.list_action);
      const result = listing ? await call(listing, current.values) : [];
      if (
        !alive.current ||
        version !== epoch.current ||
        request !== reads.current ||
        latest.current.options.suspended
      )
        return;
      const nextChoices = Object.fromEntries(data);
      setChoices(nextChoices);
      const invalid = (group.fields ?? []).filter((field) => {
        if (!field.options || current.values[field.name] === undefined || current.values[field.name] === '')
          return false;
        const options = atPath(nextChoices[field.name], field.options.items);
        return (
          !Array.isArray(options) ||
          !options.some((item) => Object.is(atPath(item, field.options!.value), current.values[field.name]))
        );
      });
      if (invalid.length && !step) {
        epoch.current++;
        setValues((before) => ({
          ...before,
          ...Object.fromEntries(invalid.map((field) => [field.name, undefined])),
        }));
        setResults({});
      }
      const sampled = current.options.step?.example?.items;
      const list = Array.isArray(sampled)
        ? sampled
        : Array.isArray(result)
          ? result
          : atPath(result, 'items');
      setRows(Array.isArray(list) ? list.map(objectValue) : []);
      setError('');
    } catch (failure) {
      if (
        alive.current &&
        version === epoch.current &&
        request === reads.current &&
        !latest.current.options.suspended
      )
        setError(failure instanceof Error ? failure.message : '设置读取失败');
    }
  };

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!step) void refreshRef.current();
  }, [options.suspended, surface.available, step, values]);
  useAutoRefresh(refresh, { enabled: !step && !options.suspended, interval: 5000 });
  useEffect(() => {
    if (!step) return;
    epoch.current++;
    const sample = objectValue(step.example);
    setValues({ ...initialActionValues(action.input_schema), ...sample });
    const selected = group.actions?.find((item) => step.target === `settings.${group.id}.${item.action}`);
    setResults(selected && demo?.actions ? { [selected.action]: demo.actions[selected.action] } : {});
    if (Array.isArray(sample.items)) setRows(sample.items.map(objectValue));
    void refreshRef.current();
  }, [step, demo, group, action]);

  const change = (name: string, value: unknown) => {
    if (busy.current || latest.current.options.suspended || step) return;
    epoch.current++;
    const dependents = (group.fields ?? []).filter((field) => {
      if (field.name === name) return false;
      const provider = surface.contract.actions.find((item) => item.id === field.options?.action);
      return (
        provider?.input_schema &&
        typeof provider.input_schema === 'object' &&
        name in (provider.input_schema.properties ?? {})
      );
    });
    setValues((before) => ({
      ...before,
      [name]: value,
      ...Object.fromEntries(dependents.map((field) => [field.name, undefined])),
    }));
    setResults({});
  };
  const execute = async (definition: PluginAction, input = latest.current.values): Promise<boolean> => {
    if (busy.current || latest.current.options.suspended || step) return false;
    reads.current++;
    busy.current = true;
    setResults((before) => {
      const next = { ...before };
      delete next[definition.id];
      return next;
    });
    setPending(definition.id);
    const version = epoch.current;
    let succeeded = false;
    try {
      const result = await call(definition, input);
      if (!alive.current || version !== epoch.current || latest.current.options.suspended) return false;
      setResults((before) => ({ ...before, [definition.id]: result }));
      succeeded = true;
      if (definition.permission !== 'read') infoBar({ title: `${definition.title}完成`, tone: 'ok' });
    } catch (failure) {
      if (alive.current && version === epoch.current && !latest.current.options.suspended)
        infoBar({
          title: `${definition.title}失败`,
          message: failure instanceof Error ? failure.message : '请稍后重试',
          tone: 'err',
        });
    } finally {
      busy.current = false;
      if (alive.current) setPending('');
    }
    if (succeeded && definition.permission !== 'read') await refresh();
    return succeeded;
  };
  return { action, resource, values, results, choices, rows, error, pending, change, execute, refresh };
}
