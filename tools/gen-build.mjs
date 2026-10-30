// Записывает версию и идентификатор сборки в src/shared/build.ts.
// Версия берётся из releases.json, идентификатор — из коммита и времени сборки.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const version = JSON.parse(readFileSync('releases.json', 'utf8'))[0].version;
let sha = 'local';
try { sha = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
const id = `${version}-${sha}-${Date.now().toString(36)}`;
writeFileSync('src/shared/build.ts', `// Перезаписывается скриптом tools/gen-build.mjs при сборке.\nexport const BUILD = { version: '${version}', id: '${id}' };\n`);
console.log('build', id);
