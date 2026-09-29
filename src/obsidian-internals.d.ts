import type { EventRef, Menu, Plugin, PluginManifest, SettingDefinition } from "obsidian";

declare module "obsidian" {
	interface SettingTab {
		id: string;
		name: string;
		navEl: HTMLElement;
		renderedItems?: unknown[];
		renderTab(): void;
	}

	interface PluginListSettingTab extends SettingTab {
		pluginDefinitions: Record<string, SettingDefinition>;
		getElementForDefinition(def: unknown): HTMLElement | undefined;
	}

	interface CommunityPluginsSettingTab extends PluginListSettingTab {
		buildPluginActionsMenu(menu: Menu, manifest: PluginManifest): void;
	}

	interface InternalPlugin {
		enabled: boolean;
		instance: { name: string; description: string; hiddenFromList?: boolean };
		enable(save: boolean): Promise<void>;
		disable(save: boolean): void;
	}

	interface App {
		setting: {
			settingTabs: SettingTab[];
			pluginTabs: SettingTab[];
			openTab(tab: SettingTab): void;
			openTabById(id: string): SettingTab | null;
			updatePageTitle?(): void;
			tabContainer?: HTMLElement;
			corePluginTabContainer?: HTMLElement;
			communityPluginTabContainer?: HTMLElement;
		};
		plugins: {
			manifests: Record<string, PluginManifest>;
			plugins: Record<string, Plugin>;
			enablePluginAndSave(id: string): Promise<boolean>;
			disablePluginAndSave(id: string): Promise<void>;
		};
		internalPlugins: {
			plugins: Record<string, InternalPlugin>;
			on(name: "change", callback: () => void): EventRef;
			offref(ref: EventRef): void;
		};
	}
}

declare global {
	interface Window {
		i18next: { t(key: string): string };
	}
}
