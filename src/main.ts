import { Plugin } from "obsidian";
import type { PluginLayout } from "./layout";
import { PluginsTabController } from "./pluginsTab";
import type { ListKind } from "./sources";

export interface Settings {
	hideCommunityTabs: boolean;
	hideCoreTabs: boolean;
	list: ListKind;
	advancedCollapsed: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	hideCommunityTabs: false,
	hideCoreTabs: false,
	list: "community",
	advancedCollapsed: true,
};

const HIDE_TABS_CLASS: Record<ListKind, string> = {
	community: "pd-hide-community-tabs",
	core: "pd-hide-core-tabs",
};

interface PluginData {
	version: 1;
	layouts?: Partial<Record<ListKind, PluginLayout | null>>;
	settings?: Partial<Settings> & { hidePluginTabs?: boolean };
	layout?: PluginLayout | null;
}

function readSettings(data: PluginData | null): Settings {
	const { hidePluginTabs, ...rest } = data?.settings ?? {};
	return { ...DEFAULT_SETTINGS, hideCommunityTabs: hidePluginTabs ?? false, ...rest };
}

function readLayouts(data: PluginData | null): Record<ListKind, PluginLayout | null> {
	return {
		community: data?.layouts?.community ?? data?.layout ?? null,
		core: data?.layouts?.core ?? null,
	};
}

export interface CommitOptions {
	save?: boolean;
	refresh?: boolean;
}

export default class PluginDrawersPlugin extends Plugin {
	layouts: Record<ListKind, PluginLayout | null> = { community: null, core: null };
	settings: Settings = { ...DEFAULT_SETTINGS };
	tab = new PluginsTabController(this);

	async onload(): Promise<void> {
		const data = (await this.loadData()) as PluginData | null;
		this.layouts = readLayouts(data);
		this.settings = readSettings(data);
		this.app.workspace.onLayoutReady(() => {
			this.tab.start();
			this.applySettings();
		});
	}

	onunload(): void {
		this.tab.stop();
		for (const cls of Object.values(HIDE_TABS_CLASS)) document.body.removeClass(cls);
	}

	async onExternalSettingsChange(): Promise<void> {
		const data = (await this.loadData()) as PluginData | null;
		this.layouts = readLayouts(data);
		this.settings = readSettings(data);
		this.applySettings();
		this.tab.update();
	}

	commitLayout(kind: ListKind, layout: PluginLayout, { save = true, refresh = true }: CommitOptions = {}): void {
		this.layouts[kind] = layout;
		if (save) this.save();
		if (refresh) this.tab.refresh();
	}

	updateSettings(patch: Partial<Settings>, refresh = true): void {
		this.settings = { ...this.settings, ...patch };
		this.save();
		this.applySettings();
		if (refresh) this.tab.refresh();
	}

	private applySettings(): void {
		const active = this.tab.isActive();
		document.body.toggleClass(HIDE_TABS_CLASS.community, active && this.settings.hideCommunityTabs);
		document.body.toggleClass(HIDE_TABS_CLASS.core, active && this.tab.hasCoreList() && this.settings.hideCoreTabs);
	}

	private save(): void {
		void this.saveData({ version: 1, layouts: this.layouts, settings: this.settings } satisfies PluginData);
	}
}
