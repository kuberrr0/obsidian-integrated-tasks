import type { App } from "obsidian";
import { DEFAULT_DATE_FORMAT } from "./date";

interface DailyNotesPlugin {
  instance?: {
    options?: {
      format?: string;
    };
  };
}

interface AppWithInternalPlugins extends App {
  internalPlugins?: {
    getPluginById?: (id: string) => DailyNotesPlugin | undefined;
  };
}

export function dailyNoteDateFormat(app: App): string {
  const plugin = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("daily-notes");
  return plugin?.instance?.options?.format?.trim() || DEFAULT_DATE_FORMAT;
}
