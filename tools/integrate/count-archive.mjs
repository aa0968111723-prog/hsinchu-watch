import { readFile } from 'node:fs/promises'
import { ARCHIVE_FILES, buildArchive } from '../../src/lib/archive-model.js'

const docs = {}
for (const [id, path] of Object.entries(ARCHIVE_FILES)) {
  try {
    docs[id] = JSON.parse(await readFile(new URL('../../public' + path, import.meta.url), 'utf8'))
  } catch (error) {
    if (!['monitorHistory', 'monitorLatest'].includes(id)) throw error
  }
}
const { rows, held } = buildArchive(docs)
const byKind = {}
for (const row of rows) byKind[row.kind] = (byKind[row.kind] || 0) + 1
console.log(JSON.stringify({ rows: rows.length, held, byKind }))
