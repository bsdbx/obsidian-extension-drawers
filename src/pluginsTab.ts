import { around } from "monkey-around";
import {
	ButtonComponent,
	CommunityPluginsSettingTab,
	debounce,
	ExtraButtonComponent,
	Modal,
	Notice,
	PluginListSettingTab,
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingDefinitionList,
	SettingTab,
	setIcon,
} from "obsidian";
import { DEFAULT_CORE_FOLDERS } from "./defaults";
import { DrawerList } from "./drawerList";
import { reconcile, seedLayout } from "./layout";
import type PluginDrawersPlugin from "./main";
import { communitySource, coreSource, ListKind, PluginSource } from "./sources";

const COMMUNITY_TAB_ID = "community-plugins";
const CORE_TAB_ID = "plugins";
const I18N = "setting.third-party-plugin.";
const TAB_NAME = "Plugins";

function isList(def: SettingDefinitionItem): def is SettingDefinitionList {
	return "type" in def && def.type === "list";
}

function pluginIdOf(tab: PluginListSettingTab, def: unknown): string | undefined {
	return Object.keys(tab.pluginDefinitions).find((id) => tab.pluginDefinitions[id] === def);
}

export class PluginsTabController {
	readonly drawers: DrawerList;
	private community: CommunityPluginsSettingTab | null = null;
	private core: PluginListSettingTab | null = null;
	private coreDefinitions: (() => SettingDefinitionItem[]) | null = null;
	private cleanups: (() => void)[] = [];
	private browseDef: SettingDefinition | null = null;
	private unwatchBrowser: (() => void) | null = null;
	private targetFolderId: string | null = null;
	private readonly drawerDef: SettingDefinition;

	constructor(readonly plugin: PluginDrawersPlugin) {
		this.drawers = new DrawerList(plugin, this);
		this.drawerDef = {
			name: "",
			render: (setting) => {
				this.drawers.mount(setting.settingEl);
				this.renderListSwitch(setting.settingEl);
				return () => this.drawers.unmount(setting.settingEl);
			},
		};
	}

	get communityTab(): CommunityPluginsSettingTab | null {
		return this.community;
	}

	isActive(): boolean {
		return !!this.community;
	}

	hasCoreList(): boolean {
		return !!this.core;
	}

	get list(): ListKind {
		return this.core ? this.plugin.settings.list : "community";
	}

	source(kind: ListKind = this.list): PluginSource {
		return kind === "core" ? coreSource(this.plugin.app) : communitySource(this.plugin.app);
	}

	start(): void {
		if (this.community) return;
		const setting = this.plugin.app.setting;
		const community = setting?.settingTabs?.find((t) => t.id === COMMUNITY_TAB_ID) as
			CommunityPluginsSettingTab | undefined;
		if (!community || typeof community.buildPluginActionsMenu !== "function" || !community.pluginDefinitions)
			return;
		this.community = community;

		this.cleanups.push(
			around(community, {
				getSettingDefinitions: (original) => () => this.transform(original.call(community)),
				getElementForDefinition: (original) => (def: unknown) => {
					const el = this.elementFor(def) ?? original.call(community, def);
					if (el?.closest(".pd-advanced.is-collapsed")) this.setAdvancedCollapsed(false);
					return el;
				},
				renderTab: (original) => () => {
					original.call(community);
					this.decorateAdvanced();
				},
			}),
		);
		this.cleanups.push(() => this.stopWatchingBrowser());

		const originalName = community.name;
		community.name = TAB_NAME;
		this.setNavTitle(community, TAB_NAME);
		this.cleanups.push(() => {
			community.name = originalName;
			this.setNavTitle(community, originalName);
		});

		this.startCore();

		this.rebuild(community);
		setting.updatePageTitle?.();
	}

	stop(): void {
		const community = this.community;
		if (!community) return;
		const core = this.core;
		this.community = null;
		this.core = null;
		this.coreDefinitions = null;
		for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
		this.browseDef = null;
		this.rebuild(community);
		if (core) this.rebuild(core);
		this.plugin.app.setting.updatePageTitle?.();
	}

	private startCore(): void {
		const setting = this.plugin.app.setting;
		const community = this.community;
		const core = setting.settingTabs.find((t) => t.id === CORE_TAB_ID) as PluginListSettingTab | undefined;
		if (!community || !core?.pluginDefinitions || !this.plugin.app.internalPlugins?.plugins) return;
		this.core = core;

		this.cleanups.push(
			around(core, {
				getSettingDefinitions: (original) => {
					this.coreDefinitions = () => original.call(core);
					return () => [];
				},
				getElementForDefinition: (original) => (def: unknown) =>
					this.elementFor(def) ?? original.call(core, def),
			}),
		);
		this.cleanups.push(
			around(setting, {
				openTab: (original) => (tab: SettingTab) => {
					if (tab !== core) return original.call(setting, tab);
					this.showList("core");
					return original.call(setting, community);
				},
			}),
		);

		core.navEl.addClass("pd-hidden-tab");
		this.cleanups.push(() => core.navEl.removeClass("pd-hidden-tab"));

		const internal = this.plugin.app.internalPlugins;
		const ref = internal.on(
			"change",
			debounce(() => this.community?.update(), 100, true),
		);
		this.cleanups.push(() => internal.offref(ref));

		this.rebuild(core);
	}

	private rebuild(tab: SettingTab): void {
		if (Array.isArray(tab.renderedItems)) tab.renderedItems = [];
		tab.update();
	}

	private setNavTitle(tab: SettingTab, name: string): void {
		tab.navEl?.querySelector(".vertical-tab-nav-item-title")?.setText(name);
	}

	update(): void {
		this.community?.update();
	}

	refresh(): void {
		this.drawers.refresh();
	}

	showList(kind: ListKind): void {
		if (kind === this.list) return;
		this.plugin.updateSettings({ list: kind }, false);
		this.community?.update();
	}

	openBrowser(folderId: string | null): void {
		const button =
			this.browseDef && this.community?.getElementForDefinition(this.browseDef)?.querySelector("button");
		if (!button) {
			new Notice("Couldn't open the community plugin browser.");
			return;
		}
		this.stopWatchingBrowser();

		const opened: Modal[] = [];
		const unpatchOpen = around(Modal.prototype, {
			open: (original) =>
				function (this: Modal) {
					if (this.modalEl.hasClass("mod-community-plugin")) opened.push(this);
					return original.call(this);
				},
		});
		try {
			button.click();
		} finally {
			unpatchOpen();
		}
		const browser = opened[0];
		if (!folderId || !browser) return;

		this.targetFolderId = folderId;
		this.unwatchBrowser = around(browser, {
			onClose: (original) => () => {
				this.stopWatchingBrowser();
				return original.call(browser);
			},
		});
	}

	private stopWatchingBrowser(): void {
		this.unwatchBrowser?.();
		this.unwatchBrowser = null;
		this.targetFolderId = null;
	}

	private transform(defs: SettingDefinitionItem[]): SettingDefinitionItem[] {
		const community = this.community;
		if (!community) return defs;
		const communityDefs = new Set<unknown>(Object.values(community.pluginDefinitions));
		const installedHeading = window.i18next.t(I18N + "label-installed-plugins");
		const index = defs.findIndex(
			(d) => isList(d) && (d.heading === installedHeading || !!d.items?.some((i) => communityDefs.has(i))),
		);
		if (index === -1) return defs;
		const communityList = defs[index] as SettingDefinitionList;

		const browseName = window.i18next.t(I18N + "option-browse-community-plugins");
		const nativeBrowse = defs.find(
			(d): d is SettingDefinition => !("type" in d) && d.name === browseName && "render" in d,
		);
		this.browseDef = nativeBrowse ? { ...nativeBrowse, searchable: false } : null;

		this.syncLayout("community", Object.keys(community.pluginDefinitions));
		const core = this.core;
		const coreList = core && this.coreDefinitions ? (this.coreDefinitions().find(isList) ?? null) : null;
		if (core && coreList) this.syncLayout("core", Object.keys(core.pluginDefinitions));

		const kind = coreList ? this.list : "community";
		const search = (kind === "core" ? coreList : communityList)?.search;
		const replacement: SettingDefinitionList = {
			type: "list",
			heading: kind === "core" ? `${TAB_NAME}\u200B` : TAB_NAME,
			cls: "pd-list",
			extraButtons: [
				this.sidebarEyeButton(kind),
				...(kind === "community" ? (communityList.extraButtons ?? []) : []),
			],
			search: search && {
				placeholder: kind === "core" ? "Search core plugins..." : "Search community plugins...",
				match: (def, query) =>
					def === this.drawerDef ? (this.drawers.setFilter(query), true) : search.match(def, query),
			},
			items: [
				this.drawerDef,
				...(kind === "community" ? (communityList.items ?? []).filter((i) => !communityDefs.has(i)) : []),
			],
		};
		const footer: SettingDefinitionGroup = {
			type: "group",
			cls: "pd-footer",
			items: [
				{
					name: "",
					searchable: false,
					render: (setting, group) => {
						group.addClass("pd-footer");
						setting.settingEl.empty();
						new ButtonComponent(setting.settingEl)
							.setButtonText("New Folder")
							.onClick(() => this.drawers.newFolder());
					},
				},
			],
		};
		const searchOnly: SettingDefinitionGroup = {
			type: "group",
			cls: "pd-search-only",
			items: [
				...(this.browseDef ? [this.browseDef] : []),
				...Object.values(community.pluginDefinitions),
				...(core && coreList ? Object.values(core.pluginDefinitions) : []),
			],
		};
		const others = [...defs.slice(0, index), ...defs.slice(index + 1)].filter((d) => d !== nativeBrowse);
		const advanced: SettingDefinitionGroup = {
			type: "group",
			heading: "Advanced",
			cls: "pd-advanced",
			items: others.filter((d): d is SettingDefinition => !("type" in d)),
		};
		return [replacement, footer, searchOnly, advanced, ...others.filter((d) => "type" in d)];
	}

	private renderListSwitch(hostEl: HTMLElement): void {
		if (!this.core) return;
		const groupEl = hostEl.closest(".setting-group");
		const searchEl = groupEl?.querySelector(":scope > .setting-group-search");
		if (!searchEl) return;
		searchEl.querySelector(":scope > .pd-list-switch")?.remove();
		const filtersEl = searchEl
			.createDiv("setting-group-search-control pd-list-switch")
			.createDiv("setting-group-filters");
		const labels: Record<ListKind, string> = { community: "Community plugins", core: "Core plugins" };

		for (const kind of ["community", "core"] as const) {
			const pill = filtersEl.createDiv({
				cls: "setting-group-filter",
				text: labels[kind],
				attr: { tabindex: "0" },
			});
			pill.toggleClass("is-active", kind === this.list);
			pill.addEventListener("click", () => this.showList(kind));
			pill.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					this.showList(kind);
				}
			});
		}
	}

	setAdvancedCollapsed(collapsed: boolean): void {
		this.plugin.updateSettings({ advancedCollapsed: collapsed }, false);
		this.decorateAdvanced();
	}

	private decorateAdvanced(): void {
		const groupEl = this.community?.containerEl.querySelector<HTMLElement>(":scope > .setting-group.pd-advanced");
		const headerEl = groupEl?.querySelector<HTMLElement>(":scope > .setting-item-heading");
		if (!groupEl || !headerEl) return;
		let chevron = headerEl.querySelector<HTMLElement>(":scope > .pd-advanced-chevron");
		if (!chevron) {
			chevron = createDiv("pd-advanced-chevron");
			headerEl.prepend(chevron);
			headerEl.setAttr("tabindex", "0");
			headerEl.setAttr("role", "button");
			const toggle = () => this.setAdvancedCollapsed(!this.plugin.settings.advancedCollapsed);
			headerEl.addEventListener("click", toggle);
			headerEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					toggle();
				}
			});
		}
		const collapsed = this.plugin.settings.advancedCollapsed;
		groupEl.toggleClass("is-collapsed", collapsed);
		headerEl.setAttr("aria-expanded", String(!collapsed));
		setIcon(chevron, collapsed ? "lucide-chevron-right" : "lucide-chevron-down");
	}

	private sidebarEyeButton(kind: ListKind): (button: ExtraButtonComponent) => void {
		const isHidden = () =>
			kind === "community" ? this.plugin.settings.hideCommunityTabs : this.plugin.settings.hideCoreTabs;
		return (button) => {
			const paint = () => {
				const hidden = isHidden();
				button
					.setIcon(hidden ? "lucide-eye-off" : "lucide-eye")
					.setTooltip(`${hidden ? "Show" : "Hide"} ${kind} plugin options in the sidebar`);
				button.extraSettingsEl.toggleClass("is-off", hidden);
			};
			button.extraSettingsEl.addClass("pd-sidebar-eye");
			button.onClick(() => {
				const hidden = !isHidden();
				this.plugin.updateSettings(
					kind === "community" ? { hideCommunityTabs: hidden } : { hideCoreTabs: hidden },
				);
				paint();
			});
			paint();
		};
	}

	private syncLayout(kind: ListKind, installed: string[]): void {
		const current = this.plugin.layouts[kind];
		const { layout, changed } = current
			? reconcile(current, installed, kind === "community" ? this.targetFolderId : null)
			: { layout: seedLayout(installed, kind === "core" ? DEFAULT_CORE_FOLDERS : []), changed: true };
		if (changed) this.plugin.commitLayout(kind, layout, { refresh: false });
	}

	private elementFor(def: unknown): HTMLElement | undefined {
		for (const [kind, tab] of [
			["community", this.community],
			["core", this.core],
		] as const) {
			const id = tab && pluginIdOf(tab, def);
			if (!id) continue;
			this.showList(kind);
			return this.drawers.reveal(id);
		}
		return undefined;
	}
}
