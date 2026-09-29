/**
 * Marks the ESM output directory as ESM.
 *
 * The packages are CommonJS by default (that is what the Node API and Metro
 * consume), so a nested package.json is what tells Node and bundlers that the
 * files under dist/esm are modules rather than scripts.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const target = join(process.cwd(), 'dist', 'esm');
if (!existsSync(target)) mkdirSync(target, { recursive: true });

writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
