import type { FolderPreset } from "./layout";

export const DEFAULT_CORE_FOLDERS: FolderPreset[] = [
	{
		id: "f-core-navigate",
		name: "Find & Navigate",
		items: [
			"file-explorer",
			"global-search",
			"switcher",
			"command-palette",
			"bookmarks",
			"tag-pane",
			"outline",
			"random-note",
		],
	},
	{ id: "f-core-links", name: "Links & Graph", items: ["graph", "backlink", "outgoing-link", "page-preview"] },
	{
		id: "f-core-writing",
		name: "Writing",
		items: [
			"templates",
			"daily-notes",
			"zk-prefixer",
			"note-composer",
			"slash-command",
			"properties",
			"footnotes",
			"word-count",
		],
	},
	{ id: "f-core-views", name: "Canvas & Views", items: ["canvas", "bases", "slides", "webviewer", "audio-recorder"] },
	{
		id: "f-core-vault",
		name: "Vault & Sync",
		items: ["sync", "publish", "file-recovery", "workspaces", "markdown-importer"],
	},
];
