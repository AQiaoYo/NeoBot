// SDK 声明式功能、资源与教程；页面不推断权限或执行插件脚本。
export type PluginPermission = 'read' | 'operate' | 'manage';

export type JsonSchema =
  | boolean
  | {
      type?: string | string[];
      title?: string;
      description?: string;
      default?: unknown;
      enum?: unknown[];
      properties?: Record<string, JsonSchema>;
      required?: string[];
      items?: JsonSchema | JsonSchema[];
      minimum?: number;
      maximum?: number;
      $ref?: string;
      $defs?: Record<string, JsonSchema>;
      [key: string]: unknown;
    };

export interface PluginAction {
  id: string;
  title: string;
  description?: string;
  permission: PluginPermission;
  input_schema: JsonSchema | null;
  output_schema: JsonSchema | null;
}

export interface PluginResource {
  id: string;
  title: string;
  list_action: string;
  columns: Array<{ key: string; title: string }>;
  create_action?: string | null;
  delete_action?: string | null;
}

export interface PluginGuide {
  id: string;
  title: string;
  steps: PluginGuideStep[];
  completion_action?: string | null;
  demo?: PluginGuideDemo;
}

export interface PluginGuideStep {
  target: string;
  text: string;
  chapter?: string;
  example?: Record<string, unknown>;
  command?: { text: string; context: string; reply?: string };
}

export interface PluginGuideDemo {
  actions?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface PluginView {
  id: string;
  title: string;
  entry: string;
  anchors: string[];
  url?: string;
}

export interface PluginSurfaceContract {
  schema_version: 1;
  plugin: { name: string; version?: string; description?: string };
  config: JsonSchema | null;
  actions: PluginAction[];
  resources: PluginResource[];
  guides: PluginGuide[];
  views?: PluginView[];
  settings?: PluginSettingsGroup[];
}

export interface PluginSettingsField {
  name: string;
  control?: 'auto' | 'text' | 'select';
  placeholder?: string;
  description?: string;
  options?: { action: string; items: string; value: string; label: string } | null;
}

export interface PluginSettingsGroup {
  id: string;
  title: string;
  description?: string;
  collapsed?: boolean;
  input_action: string;
  submit_label?: string;
  require_action?: string | null;
  fields?: PluginSettingsField[];
  actions?: Array<{ action: string; label?: string; display?: 'summary' | 'html' }>;
  resource?: string | null;
  edit_action?: string | null;
  switch_fields?: string[];
}

export interface PluginSurfacePayload {
  ok?: boolean;
  contract: PluginSurfaceContract | null;
  available: boolean;
  state: string;
  permissions: PluginPermission[];
  source: 'runtime' | 'package' | 'none';
}

export interface PluginActionPayload {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
  fields?: Array<{ path: Array<string | number>; type: string }>;
}
