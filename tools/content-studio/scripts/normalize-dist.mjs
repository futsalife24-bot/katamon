import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(projectRoot, 'dist')
const textExtensions = new Set(['.css', '.html', '.js', '.webmanifest'])

function assertInsideDist(filePath) {
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    throw new Error('出力先がdistディレクトリ外です。')
  }
}

async function normalizeDirectory(directory) {
  assertInsideDist(directory)

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name)
    assertInsideDist(entryPath)

    if (entry.isDirectory()) {
      await normalizeDirectory(entryPath)
      continue
    }

    if (!entry.isFile() || !textExtensions.has(extname(entry.name))) {
      continue
    }

    const source = await readFile(entryPath, 'utf8')
    const normalized = source
      .replace(/[ \t]+(?=\r?\n|$)/gu, '')
      .replace(/(?:\r?\n){2,}$/u, '\n')

    if (source !== normalized) {
      await writeFile(entryPath, normalized, 'utf8')
    }
  }
}

await normalizeDirectory(distRoot)
