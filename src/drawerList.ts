import { App, ButtonComponent, Menu, Modal, setIcon, setTooltip, ToggleComponent } from "obsidian";
import {
	addFolder,
	deleteFolder,
	moveItem,
	moveSection,
	PluginFolder,
	PluginLayout,
	renameFolder,
	Section,
	sectionOf,
	setSectionCollapsed,
} from "./layout";
import type { CommitOptions, default as PluginDrawersPlugin } from "./main";
import type { PluginsTabController } from "./pluginsTab";
import type { PluginEntry, PluginSource } from "./sources";

type DragState = { kind: "item"; id: string } | { kind: "section"; index: number };

function byAuthorLabel(): string {
	const key = "setting.third-party-plugin.label-by-author";
	const label = window.i18next.t(key);
	return label && label !== key ? label : "By ";
}

export class DrawerList {
	private filter = "";
	private listEl: HTMLElement | null = null;
	private drag: DragState | null = null;
	private pendingDrop: ((layout: PluginLayout) => PluginLayout) | null = null;
	private peekEl: HTMLElement | null = null;
	private focusFolderId: string | null = null;

	constructor(
		private plugin: PluginDrawersPlugin,
		private controller: PluginsTabController,
	) {}

	mount(hostEl: HTMLElement): void {
		hostEl.empty();
		hostEl.addClass("pd-host");
		this.filter = "";
		this.drag = null;
		this.peekEl = null;
		this.listEl = hostEl;
		hostEl.addEventListener("dragleave", (evt) => {
			if (hostEl.contains(evt.relatedTarget as Node | null)) return;
			this.clearDropIndicators();
			this.setPeek(null);
		});
		this.render();
	}

	unmount(hostEl: HTMLElement): void {
		if (this.listEl === hostEl) this.listEl = null;
	}

	refresh(): void {
		if (this.listEl?.isConnected && !this.drag) this.render();
	}

	setFilter(filter: string): void {
		if (filter === this.filter) return;
		this.filter = filter;
		this.refresh();
	}

	newFolder(): void {
		const id = `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		this.focusFolderId = id;
		this.edit((l) => addFolder(l, id));
	}

	reveal(pluginId: string): HTMLElement | undefined {
		const layout = this.plugin.layouts[this.controller.list];
		const index = layout ? sectionOf(layout, pluginId) : -1;
		if (layout && index !== -1 && layout.sections[index].collapsed)
			this.edit((l) => setSectionCollapsed(l, index, false));
		return (
			this.listEl?.querySelector<HTMLElement>(`.pd-item[data-plugin-id="${CSS.escape(pluginId)}"]`) ?? undefined
		);
	}

	private edit(fn: (layout: PluginLayout) => PluginLayout, options?: CommitOptions): void {
		const kind = this.controller.list;
		const layout = this.plugin.layouts[kind];
		if (layout) this.plugin.commitLayout(kind, fn(layout), options);
	}

	private render(): void {
		const listEl = this.listEl;
		const source = this.controller.source();
		const layout = this.plugin.layouts[source.kind];
		if (!listEl) return;
		listEl.empty();
		this.peekEl = null;
		if (!layout) return;
		const tokens = this.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
		layout.sections.forEach((section, index) => this.renderSection(listEl, source, section, index, tokens));

		if (this.focusFolderId) {
			const input = listEl.querySelector<HTMLInputElement>(`[data-folder-id="${this.focusFolderId}"] .pd-name`);
			this.focusFolderId = null;
			input?.scrollIntoView({ block: "nearest" });
			input?.focus();
			input?.select();
		}
	}

	private renderSection(
		listEl: HTMLElement,
		source: PluginSource,
		section: Section,
		index: number,
		tokens: string[],
	): void {
		const matches = (text: string) => tokens.every((t) => text.toLowerCase().includes(t));
		const folderMatches = section.kind === "folder" && tokens.length > 0 && matches(section.name);
		const plugins = section.items
			.map((id) => source.get(id))
			.filter((p): p is PluginEntry => !!p)
			.filter((p) => folderMatches || matches([p.name, p.description, p.author ?? "", p.id].join("\n")));
		if (tokens.length > 0 && plugins.length === 0 && !folderMatches) return;

		const sectionEl = listEl.createDiv("pd-section");
		if (section.kind === "folder") sectionEl.dataset.folderId = section.id;
		sectionEl.toggleClass("is-collapsed", section.collapsed && tokens.length === 0);

		this.renderHeader(sectionEl, source, section, index);

		const bodyEl = sectionEl.createDiv("pd-section-body");
		if (section.items.length === 0) bodyEl.createDiv({ cls: "pd-empty", text: "Drop plugins here" });
		for (const entry of plugins) this.renderPlugin(bodyEl, source, section, entry);

		this.paintExpanded(sectionEl);
		this.wireDropTarget(sectionEl, section, index);
	}

	private renderHeader(sectionEl: HTMLElement, source: PluginSource, section: Section, index: number): void {
		const headerEl = sectionEl.createDiv("pd-section-header");

		this.makeDraggable(headerEl, sectionEl, { kind: "section", index });

		const chevron = headerEl.createDiv("clickable-icon pd-chevron");
		chevron.addEventListener("click", () => this.edit((l) => setSectionCollapsed(l, index, !section.collapsed)));

		if (section.kind === "folder") {
			headerEl.createDiv("pd-folder-icon");
			const nameEl = headerEl.createEl("input", { type: "text", cls: "pd-name", attr: { spellcheck: "false" } });
			nameEl.value = section.name;
			nameEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") nameEl.blur();
			});
			nameEl.addEventListener("change", () => this.edit((l) => renameFolder(l, section.id, nameEl.value)));
		} else {
			headerEl.createSpan({ cls: "pd-section-title", text: "Ungrouped" });
		}

		headerEl.createDiv("pd-spacer");

		if (source.kind === "community") {
			const add = headerEl.createDiv("clickable-icon pd-add");
			setIcon(add, "lucide-plus");
			setTooltip(add, section.kind === "folder" ? `Add plugin to "${section.name}"` : "Add plugin");
			add.addEventListener("click", () =>
				this.controller.openBrowser(section.kind === "folder" ? section.id : null),
			);
		}

		if (section.kind === "folder") this.renderDelete(headerEl, section);
	}

	private paintExpanded(sectionEl: HTMLElement): void {
		const expanded = !sectionEl.hasClass("is-collapsed") || sectionEl.hasClass("is-peeking");
		const chevron = sectionEl.querySelector<HTMLElement>(":scope > .pd-section-header > .pd-chevron");
		const folderIcon = sectionEl.querySelector<HTMLElement>(":scope > .pd-section-header > .pd-folder-icon");
		if (chevron) setIcon(chevron, expanded ? "lucide-chevron-down" : "lucide-chevron-right");
		if (folderIcon) setIcon(folderIcon, expanded ? "lucide-folder-open" : "lucide-folder");
	}

	private setPeek(sectionEl: HTMLElement | null): void {
		const target = sectionEl?.hasClass("is-collapsed") ? sectionEl : null;
		if (target === this.peekEl) return;
		const previous = this.peekEl;
		this.peekEl = target;
		if (previous) {
			previous.removeClass("is-peeking");
			this.paintExpanded(previous);
		}
		if (target) {
			target.addClass("is-peeking");
			this.paintExpanded(target);
		}
	}

	private renderDelete(headerEl: HTMLElement, folder: PluginFolder): void {
		const del = headerEl.createDiv("clickable-icon pd-delete");
		setIcon(del, "lucide-x");
		setTooltip(del, "Delete folder");
		del.addEventListener("click", () => {
			const doDelete = () => this.edit((l) => deleteFolder(l, folder.id));
			if (folder.items.length === 0) doDelete();
			else
				new ConfirmModal(
					this.plugin.app,
					`Delete "${folder.name}"?`,
					`Its ${folder.items.length} plugin${folder.items.length === 1 ? "" : "s"} will move to Ungrouped.`,
					doDelete,
				).open();
		});
	}

	private renderPlugin(bodyEl: HTMLElement, source: PluginSource, section: Section, entry: PluginEntry): void {
		const enabled = source.isEnabled(entry.id);
		const rowEl = bodyEl.createDiv("pd-item");
		rowEl.dataset.pluginId = entry.id;
		rowEl.dataset.index = String(section.items.indexOf(entry.id));

		this.makeDraggable(rowEl, rowEl, { kind: "item", id: entry.id });

		const infoEl = rowEl.createDiv("pd-item-info");
		const nameEl = infoEl.createDiv({ cls: "pd-item-name", text: entry.name });
		if (entry.version) {
			nameEl.appendText(" ");
			nameEl.createSpan({ cls: "u-muted u-small u-numeric", text: `v${entry.version}` });
		}
		if (entry.author) {
			nameEl.appendText(" ");
			nameEl.createSpan({ cls: "u-muted u-small", text: byAuthorLabel() + entry.author });
		}
		if (entry.description) infoEl.createDiv({ cls: "pd-item-description", text: entry.description });

		const settings = this.plugin.app.setting;
		const optionsHidden =
			source.kind === "community" ? this.plugin.settings.hideCommunityTabs : this.plugin.settings.hideCoreTabs;
		if (optionsHidden && settings.pluginTabs.some((t) => t.id === entry.id)) {
			const gear = rowEl.createDiv("clickable-icon pd-options");
			setIcon(gear, "lucide-settings");
			setTooltip(gear, "Options");
			gear.addEventListener("click", () => settings.openTabById(entry.id));
		}

		const toggle = new ToggleComponent(rowEl).setValue(enabled).onChange(async (on) => {
			const now = await source.setEnabled(entry.id, on);
			if (now !== on) toggle.setValue(now);
		});

		const tab = this.controller.communityTab;
		const manifest = this.plugin.app.plugins.manifests[entry.id];
		if (source.kind === "community" && tab && manifest) {
			rowEl.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				const menu = new Menu();
				tab.buildPluginActionsMenu(menu, manifest);
				menu.showAtMouseEvent(evt);
			});
		}
	}

	private makeDraggable(handle: HTMLElement, ghostEl: HTMLElement, state: DragState): void {
		handle.addClass("pd-draggable");
		handle.draggable = true;
		handle.addEventListener("mousedown", (evt) => {
			handle.draggable = !(evt.target as HTMLElement).closest("input, .clickable-icon, .checkbox-container");
		});
		handle.addEventListener("dragstart", (evt) => {
			evt.stopPropagation();
			this.drag = state;
			evt.dataTransfer?.setData("text/plain", state.kind === "item" ? state.id : String(state.index));
			if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
			evt.dataTransfer?.setDragImage(ghostEl, 16, 16);
			ghostEl.addClass("is-dragging");
		});
		handle.addEventListener("dragend", () => {
			ghostEl.removeClass("is-dragging");
			this.drag = null;
			this.clearDropIndicators();
			this.setPeek(null);
			this.refresh();
		});
	}

	private wireDropTarget(sectionEl: HTMLElement, section: Section, index: number): void {
		sectionEl.addEventListener("dragover", (evt) => {
			if (this.drag?.kind === "item") this.setPeek(sectionEl);
			const drop = this.dropAt(evt, sectionEl, section, index);
			if (!drop) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
			this.clearDropIndicators();
			drop.el.addClass(drop.cls);
			this.pendingDrop = drop.change;
		});
		sectionEl.addEventListener("drop", (evt) => {
			evt.preventDefault();
			const change = this.pendingDrop;
			const keepOpen = this.peekEl === sectionEl;
			this.drag = null;
			this.clearDropIndicators();
			if (!change) return;
			this.edit((l) => (keepOpen ? setSectionCollapsed(change(l), index, false) : change(l)));
		});
	}

	private dropAt(
		evt: DragEvent,
		sectionEl: HTMLElement,
		section: Section,
		index: number,
	): { el: HTMLElement; cls: string; change: (layout: PluginLayout) => PluginLayout } | null {
		const drag = this.drag;
		if (!drag) return null;
		const below = (el: HTMLElement) => {
			const rect = el.getBoundingClientRect();
			return evt.clientY > rect.top + rect.height / 2;
		};

		if (drag.kind === "section") {
			const after = below(sectionEl);
			let to = index + (after ? 1 : 0);
			if (drag.index < to) to--;
			return {
				el: sectionEl,
				cls: after ? "pd-drop-after" : "pd-drop-before",
				change: (l) => moveSection(l, drag.index, to),
			};
		}

		const row = (evt.target as HTMLElement).closest<HTMLElement>(".pd-item");
		if (row && sectionEl.contains(row)) {
			const after = below(row);
			const to = Number(row.dataset.index) + (after ? 1 : 0);
			return {
				el: row,
				cls: after ? "pd-drop-after" : "pd-drop-before",
				change: (l) => moveItem(l, drag.id, index, to),
			};
		}
		return {
			el: sectionEl,
			cls: "pd-drop-into",
			change: (l) => moveItem(l, drag.id, index, section.items.length),
		};
	}

	private clearDropIndicators(): void {
		this.pendingDrop = null;
		this.listEl
			?.querySelectorAll(".pd-drop-before, .pd-drop-after, .pd-drop-into")
			.forEach((el) => el.removeClass("pd-drop-before", "pd-drop-after", "pd-drop-into"));
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		title: string,
		private message: string,
		private onConfirm: () => void,
	) {
		super(app);
		this.setTitle(title);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		const buttons = this.contentEl.createDiv("modal-button-container");
		new ButtonComponent(buttons)
			.setButtonText("Delete")
			.setDestructive()
			.onClick(() => {
				this.close();
				this.onConfirm();
			});
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
