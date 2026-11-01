import {readFile,readdir} from 'node:fs/promises';
// Every D1 integration test uses the full current migration history.
export async function applySchema(db){for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())await db.exec((await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).replace(/\n/g,' '));}
