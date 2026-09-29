import type { App } from "obsidian";

export type ListKind = "community" | "core";

export interface PluginEntry {
	id: string;
	name: string;
	description: string;
	version?: string;
	author?: string;
}

export interface PluginSource {
	kind: ListKind;
	get(id: string): PluginEntry | null;
	isEnabled(id: string): boolean;
	setEnabled(id: string, enabled: boolean): Promise<boolean>;
}

export function communitySource(app: App): PluginSource {
	const plugins = app.plugins;
	return {
		kind: "community",
		get: (id) => {
			const m = plugins.manifests[id];
			return m ? { id, name: m.name, description: m.description, version: m.version, author: m.author } : null;
		},
		isEnabled: (id) => !!plugins.plugins[id],
		setEnabled: async (id, enabled) => {
			if (enabled) return plugins.enablePluginAndSave(id);
			await plugins.disablePluginAndSave(id);
			return false;
		},
	};
}

export function coreSource(app: App): PluginSource {
	const internal = app.internalPlugins;
	return {
		kind: "core",
		get: (id) => {
			const p = internal.plugins[id];
			return p && !p.instance.hiddenFromList
				? { id, name: p.instance.name, description: p.instance.description }
				: null;
		},
		isEnabled: (id) => !!internal.plugins[id]?.enabled,
		setEnabled: async (id, enabled) => {
			const p = internal.plugins[id];
			if (!p) return false;
			if (enabled) await p.enable(true);
			else p.disable(true);
			return p.enabled;
		},
	};
}
