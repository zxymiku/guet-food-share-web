import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlatformProxy} from 'wrangler';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.js';
import {normalize} from '../src/validation.js';
import {readAllPlaces,placeArchive} from '../public/place-data.js';
import {saveCredentials,loadCredentials,clearCredentials} from '../public/map-credentials.js';

const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const keyA={key:'a'.repeat(32),securityJsCode:'b'.repeat(32)};
const keyB={key:'c'.repeat(32),securityJsCode:'d'.repeat(32)};

test('personal API survives browser restart by default, can be temporary or cleared',()=>{
  const local=memory(),session=memory();
  saveCredentials(keyA,undefined,session,local);
  assert.deepEqual(loadCredentials(memory(),local),{...keyA,remember:true});
  saveCredentials(keyB,false,session,local);
  assert.deepEqual(loadCredentials(session,local),{...keyB,remember:false});
  assert.equal(loadCredentials(memory(),local),null);
  saveCredentials(keyB,true,session,local);clearCredentials(session,local);
  assert.equal(loadCredentials(session,local),null);
});

test('bad input and failed writes preserve working local credentials',()=>{
  const local=memory(),session=memory();saveCredentials(keyA,true,session,local);
  assert.throws(()=>saveCredentials({...keyB,key:'bad'},true,session,local));
  assert.deepEqual(loadCredentials(session,local),{...keyA,remember:true});
  assert.throws(()=>saveCredentials(keyB,false,{setItem(){throw new Error('disabled');}},local));
  assert.deepEqual(loadCredentials(session,local),{...keyA,remember:true});
});

test('501 shared records: tied timestamps, key-independent reads, lossless safe archive, invalid cursors',async()=>{
  const proxy=await getPlatformProxy({persist:false});
  try{
    const env={...proxy.env,APP_ORIGIN:'https://food.test',DATA_ENCRYPTION_KEY:'test-only-'.repeat(5)};
    await env.DB.exec((await readFile(new URL('../migrations/0001_init.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
    await env.DB.exec((await readFile(new URL('../migrations/0006_places_pagination.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
    for(const name of ['0007_reviews_deletions.sql','0008_discovery_trust.sql'])await env.DB.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/\n/g,' '));
    const payload={name:'测试门店',category:'面馆',address:'测试地址',description:'推荐理由',directions:'步行路线',location:{lng:110.299121,lat:25.274215,crs:'GCJ-02'},photos:['/api/photos/11111111-1111-1111-1111-111111111111'],videos:['/api/media/22222222-2222-2222-2222-222222222222'],consent:true};
    const dirty={...payload,key:keyA.key,securityJsCode:keyA.securityJsCode,token:'private',location:{...payload.location,key:'private'}};
    assert.equal(normalize(dirty).key,undefined);assert.equal(normalize(dirty).location.key,undefined);
    for(let offset=0;offset<501;offset+=100){
      const statements=[];
      for(let i=offset;i<Math.min(offset+100,501);i++){
        const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
        statements.push(env.DB.prepare('INSERT INTO places(id,payload,published_at) VALUES (?,?,?)').bind(id,JSON.stringify(dirty),'2026-10-30T10:00:00.000Z'));
      }
      await env.DB.batch(statements);
    }
    const request=async(path)=>{const r=await worker.fetch(new Request('https://food.test'+path),env);assert.equal(r.status,200);if(path.startsWith('/api/places'))assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');return r.json();};
    const first=await request('/api/places?limit=200');assert.ok(first.nextCursor);assert.equal(first.places.length,200);
    const a=await readAllPlaces(request);assert.equal(a.length,501);assert.equal(new Set(a.map(p=>p.id)).size,501);
    env.AMAP_WEB_KEY=keyB.key;env.AMAP_SECURITY_JS_CODE=keyB.securityJsCode;
    const b=await readAllPlaces(request);assert.deepEqual(a,b);
    const config=await request('/api/config');assert.ok(!JSON.stringify(config).includes(keyB.key));
    const exported=placeArchive(b.map(p=>({...p,key:keyB.key,securityJsCode:keyB.securityJsCode})), 'https://food.test');
    assert.equal(exported.places.length,501);assert.ok(!JSON.stringify(exported).includes(keyB.key));assert.ok(!JSON.stringify(exported).includes(keyA.key));
    for(const p of exported.places){assert.deepEqual(p.location,payload.location);assert.deepEqual(p.photos,payload.photos);assert.deepEqual(p.videos,payload.videos);assert.equal(p.description,payload.description);assert.equal(p.directions,payload.directions);assert.ok(p.publishedAt);}
    for(const suffix of ['?limit=0','?limit=501','?cursor=bad','?cursor='+encodeURIComponent(btoa(JSON.stringify(['bad','bad'])))]){
      assert.equal((await worker.fetch(new Request('https://food.test/api/places'+suffix),env)).status,400);
    }
    for(const path of ['/api/location','/_AMapService/v3/geocode/regeo'])assert.equal((await worker.fetch(new Request('https://food.test'+path),env)).status,410);
  }finally{await proxy.dispose();}
});
