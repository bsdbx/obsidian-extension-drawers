export interface PluginFolder {
	kind: "folder";
	id: string;
	name: string;
	collapsed: boolean;
	items: string[];
}

export interface UngroupedSection {
	kind: "ungrouped";
	collapsed: boolean;
	items: string[];
}

export type Section = PluginFolder | UngroupedSection;

export interface PluginLayout {
	sections: Section[];
}

export const DEFAULT_FOLDER_NAME = "New folder";

export interface FolderPreset {
	id: string;
	name: string;
	items: string[];
}

export function seedLayout(installed: string[], presets: FolderPreset[] = []): PluginLayout {
	const installedSet = new Set(installed);
	const folders: PluginFolder[] = presets.map((p) => ({
		kind: "folder",
		id: p.id,
		name: p.name,
		collapsed: false,
		items: p.items.filter((id) => installedSet.has(id)),
	}));
	const placed = new Set(folders.flatMap((f) => f.items));
	return {
		sections: [
			{ kind: "ungrouped", collapsed: false, items: installed.filter((id) => !placed.has(id)) },
			...folders.filter((f) => f.items.length > 0),
		],
	};
}

export function cloneLayout(layout: PluginLayout): PluginLayout {
	return structuredClone(layout);
}

export function getUngrouped(layout: PluginLayout): UngroupedSection {
	const u = layout.sections.find((s): s is UngroupedSection => s.kind === "ungrouped");
	if (!u) throw new Error("Plugin Layout has no Ungrouped section");
	return u;
}

export function findFolder(layout: PluginLayout, folderId: string): PluginFolder | undefined {
	return layout.sections.find((s): s is PluginFolder => s.kind === "folder" && s.id === folderId);
}

export function reconcile(
	input: PluginLayout,
	installed: string[],
	targetFolderId: string | null = null,
): { layout: PluginLayout; changed: boolean } {
	const layout = cloneLayout(input);
	let changed = false;

	const ungroupedSections = layout.sections.filter((s) => s.kind === "ungrouped");
	if (ungroupedSections.length === 0) {
		layout.sections.push({ kind: "ungrouped", collapsed: false, items: [] });
		changed = true;
	} else if (ungroupedSections.length > 1) {
		const [keep, ...extra] = ungroupedSections;
		for (const s of extra) keep.items.push(...s.items);
		layout.sections = layout.sections.filter((s) => !(extra as Section[]).includes(s));
		changed = true;
	}

	const installedSet = new Set(installed);
	const seen = new Set<string>();
	for (const s of layout.sections) {
		const before = s.items.length;
		s.items = s.items.filter((id) => installedSet.has(id) && !seen.has(id) && (seen.add(id), true));
		if (s.items.length !== before) changed = true;
	}

	const newcomers = installed.filter((id) => !seen.has(id));
	if (newcomers.length > 0) {
		const target = (targetFolderId && findFolder(layout, targetFolderId)) || getUngrouped(layout);
		target.items.push(...newcomers);
		changed = true;
	}
	return { layout, changed };
}

export function addFolder(input: PluginLayout, id: string): PluginLayout {
	const layout = cloneLayout(input);
	layout.sections.push({ kind: "folder", id, name: DEFAULT_FOLDER_NAME, collapsed: false, items: [] });
	return layout;
}

export function deleteFolder(input: PluginLayout, folderId: string): PluginLayout {
	const layout = cloneLayout(input);
	const folder = findFolder(layout, folderId);
	if (!folder) return layout;
	getUngrouped(layout).items.push(...folder.items);
	layout.sections = layout.sections.filter((s) => s !== folder);
	return layout;
}

export function renameFolder(input: PluginLayout, folderId: string, name: string): PluginLayout {
	const layout = cloneLayout(input);
	const folder = findFolder(layout, folderId);
	if (folder) folder.name = name.trim() || DEFAULT_FOLDER_NAME;
	return layout;
}

export function moveSection(input: PluginLayout, fromIndex: number, toIndex: number): PluginLayout {
	const layout = cloneLayout(input);
	const [s] = layout.sections.splice(fromIndex, 1);
	if (!s) return input;
	layout.sections.splice(Math.max(0, Math.min(toIndex, layout.sections.length)), 0, s);
	return layout;
}

export function moveItem(input: PluginLayout, pluginId: string, toSection: number, toIndex: number): PluginLayout {
	const layout = cloneLayout(input);
	const target = layout.sections[toSection];
	if (!target) return input;
	for (const s of layout.sections) {
		const i = s.items.indexOf(pluginId);
		if (i === -1) continue;
		s.items.splice(i, 1);
		if (s === target && i < toIndex) toIndex--;
		target.items.splice(Math.max(0, Math.min(toIndex, target.items.length)), 0, pluginId);
		return layout;
	}
	return input;
}

export function setSectionCollapsed(input: PluginLayout, sectionIndex: number, collapsed: boolean): PluginLayout {
	const layout = cloneLayout(input);
	const s = layout.sections[sectionIndex];
	if (s) s.collapsed = collapsed;
	return layout;
}

export function sectionOf(layout: PluginLayout, pluginId: string): number {
	return layout.sections.findIndex((s) => s.items.includes(pluginId));
}
