import {normalize, InputError} from './validation.js';

// Public records are deliberately independent of the map provider credentials.
// Whitelisting also protects exports if a legacy record contains extra fields.
export function publicPlace(row) {
  return {...normalize(JSON.parse(row.payload)), id:row.id,
    createdAt:row.created_at || null, publishedAt:row.published_at};
}

export async function listPlaces(db, url) {
  const requested=url.searchParams.get('limit') ?? '200';
  if(!/^\d+$/.test(requested) || Number(requested)<1 || Number(requested)>500) throw new InputError('每页数量应为 1～500');
  const limit=Number(requested);
  let cursor=null;
  if(url.searchParams.has('cursor')) {
    try {
      const encoded=url.searchParams.get('cursor');
      if(encoded.length>300)throw new Error();
      cursor=JSON.parse(atob(encoded));
      if(!Array.isArray(cursor)||cursor.length!==2||typeof cursor[0]!=='string'||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(cursor[0])||typeof cursor[1]!=='string'||!/^[0-9a-f-]{36}$/.test(cursor[1]))throw new Error();
    } catch {throw new InputError('分页游标无效，请重新加载地点');}
  }
  // Stable keyset pagination: equal timestamps cannot drop or duplicate records.
  const where=cursor?'WHERE p.published_at < ? OR (p.published_at = ? AND p.id < ?)':'';
  const query=db.prepare(`SELECT p.id,p.payload,p.published_at,s.created_at FROM places p LEFT JOIN submissions s ON s.id=p.id ${where} ORDER BY p.published_at DESC,p.id DESC LIMIT ?`);
  const rows=await query.bind(...(cursor?[cursor[0],cursor[0],cursor[1]]:[]),limit+1).all();
  const page=rows.results.slice(0,limit),last=page.at(-1);
  return {schemaVersion:1, crs:'GCJ-02', places:page.map(publicPlace),
    nextCursor:rows.results.length>limit?btoa(JSON.stringify([last.published_at,last.id])):null};
}
