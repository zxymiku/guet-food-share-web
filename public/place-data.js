// This module never reads browser storage or map credentials.
export async function readAllPlaces(request, onPage=()=>{}) {
  const records=new Map(),seen=new Set();
  let cursor=null;
  do {
    const data=await request('/api/places?limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    for(const place of data.places)records.set(place.id,place);
    onPage([...records.values()]);
    cursor=data.nextCursor || null;
    if(cursor && seen.has(cursor))throw new Error('地点分页异常，请稍后刷新');
    if(cursor)seen.add(cursor);
  } while(cursor);
  return [...records.values()];
}

export function placeArchive(places, origin, now=new Date()) {
  // Never serialize application state: it can contain login or local credentials.
  return {format:'guet-food-places',schemaVersion:1,exportedAt:now.toISOString(),
    source:origin,mediaBaseUrl:origin,crs:'GCJ-02',
    places:places.map(p=>({id:p.id,schemaVersion:p.schemaVersion,name:p.name,category:p.category,
      address:p.address,description:p.description,directions:p.directions,
      location:{lng:p.location.lng,lat:p.location.lat,crs:'GCJ-02'},
      photos:[...(p.photos||[])],videos:[...(p.videos||[])],consent:p.consent===true,
      createdAt:p.createdAt??null,publishedAt:p.publishedAt??null}))};
}
