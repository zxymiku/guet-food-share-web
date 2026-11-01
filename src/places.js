import {normalize, InputError} from './validation.js';

// Public records are deliberately independent of the map provider credentials.
// Whitelisting also protects exports if a legacy record contains extra fields.
export function publicPlace(row) {
  const data=JSON.parse(row.payload);
  return {...normalize(data, {categories:[{name:data.category,children:[data.subcategory||'']}]}), id:row.id,
    rating:{count:Number(row.review_count||0),average:row.review_average==null?null:Number(row.review_average)},
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
  const where='WHERE h.place_id IS NULL'+(cursor?' AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))':'');
  const query=db.prepare(`SELECT p.id,p.payload,p.published_at,s.created_at,r.review_count,r.review_average FROM places p LEFT JOIN submissions s ON s.id=p.id LEFT JOIN hidden_places h ON h.place_id=p.id LEFT JOIN (SELECT place_id,count(*) AS review_count,avg(score) AS review_average FROM reviews WHERE removed_at IS NULL GROUP BY place_id) r ON r.place_id=p.id ${where} ORDER BY p.published_at DESC,p.id DESC LIMIT ?`);
  const rows=await query.bind(...(cursor?[cursor[0],cursor[0],cursor[1]]:[]),limit+1).all();
  const page=rows.results.slice(0,limit),last=page.at(-1);
  return {schemaVersion:1, crs:'GCJ-02', places:page.map(publicPlace),
    nextCursor:rows.results.length>limit?btoa(JSON.stringify([last.published_at,last.id])):null};
}

export async function getPlace(db,id){
 const row=await db.prepare('SELECT p.*,s.created_at,(SELECT count(*) FROM reviews WHERE place_id=p.id AND removed_at IS NULL) AS review_count,(SELECT avg(score) FROM reviews WHERE place_id=p.id AND removed_at IS NULL) AS review_average FROM places p LEFT JOIN submissions s ON s.id=p.id WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM hidden_places WHERE place_id=p.id)').bind(id).first();return row?publicPlace(row):null;
}
