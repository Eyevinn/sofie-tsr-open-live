// @ts-check
// Writes manifest.json and translations.json at the package root, as TSR's plugin loader requires.
import fs from 'fs'

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/$schemas/${f}`, import.meta.url), 'utf8'))
const options = read('options.json')
const mappings = read('mappings.json')
const actions = read('actions.json')

/** @type {Record<string, import('timeline-state-resolver-api').TSRDevicesManifestEntry>} */
const manifest = {
	OPEN_LIVE: {
		displayName: 'Open Live',
		configSchema: JSON.stringify(options),
		actions: actions.actions.map((a) => ({ ...a, payload: a.payload ? JSON.stringify(a.payload) : undefined })),
		mappingsSchemas: Object.fromEntries(Object.entries(mappings.mappings).map(([id, s]) => [id, JSON.stringify(s)])),
	},
}

fs.writeFileSync(new URL('../manifest.json', import.meta.url), JSON.stringify(manifest, null, 2))
fs.writeFileSync(new URL('../translations.json', import.meta.url), JSON.stringify([], null, 2))
console.log('wrote manifest.json, translations.json')
