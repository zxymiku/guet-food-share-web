import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlatformProxy} from 'wrangler';
import {applySchema} from './schema.mjs';
import worker from '../src/worker.js';
import {publicMapConfig,publicMapProxy} from '../src/public-map.js';
import {navigationLinks,positionLinks} from '../public/navigation.js';
const publicEnv={APP_ORIGIN:'https://food.test',AMAP_PUBLIC_MAP_ENABLED:'true',AMAP_PUBLIC_WEB_KEY:'a'.repeat(32),AMAP_PUBLIC_SECURITY_JS_CODE:'b'.repeat(32),AMAP_PUBLIC_ANDROID_KEY:'c'.repeat(32)};
test('only opted-in developer app identifiers are public; the security secret remains server-side',async()=>{
 const r=await worker.fetch(new Request('https://food.test/api/config'),publicEnv),data=await r.json();
 assert.equal(data.publicMap.webKey,publicEnv.AMAP_PUBLIC_WEB_KEY);assert.equal(data.publicMap.androidKey,publicEnv.AMAP_PUBLIC_ANDROID_KEY);
 assert.ok(!JSON.stringify(data).includes(publicEnv.AMAP_PUBLIC_SECURITY_JS_CODE));
 assert.equal(publicMapConfig({...publicEnv,AMAP_PUBLIC_MAP_ENABLED:'false'}).webKey,null);
 assert.equal(publicMapConfig({...publicEnv,AMAP_PUBLIC_SECURITY_JS_CODE:''}).webReady,false);
});
test('public map proxy confines upstream, rejects personal keys and enforces IP/hour and total/day quotas',async t=>{
 const proxy=await getPlatformProxy({persist:false}),original=globalThis.fetch;let calls=0;
 try{
  const env={...proxy.env,...publicEnv,AMAP_PUBLIC_PROXY_IP_HOURLY_LIMIT:'1',AMAP_PUBLIC_PROXY_DAILY_LIMIT:'2'};await applySchema(env.DB);
  globalThis.fetch=async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://restapi.amap.com');assert.equal(u.searchParams.get('jscode'),env.AMAP_PUBLIC_SECURITY_JS_CODE);assert.equal(options.headers.Referer,'https://food.test/');assert.ok(!options.headers.Cookie);return new Response(JSON.stringify({status:'1',echo:env.AMAP_PUBLIC_SECURITY_JS_CODE}));};
  const call=(suffix,ip='192.0.2.1',headers={})=>publicMapProxy(new Request('https://food.test/_AMapService/'+suffix,{headers:{'CF-Connecting-IP':ip,...headers}}),env);
  assert.equal((await call('v3/geocode/regeo')).status,403);
  assert.equal((await call('v3/ias?key=personal-private-key')).status,400);
  assert.equal((await call('v3/ias?jscode=private')).status,400);
  assert.equal((await call('v3/ias?callback=alert(1)')).status,400);
  assert.equal((await call('v3/ias','192.0.2.1',{Origin:'https://evil.test'})).status,403);
  assert.equal(calls,0);
  const first=await call('v3/ias?key='+env.AMAP_PUBLIC_WEB_KEY);assert.equal(first.status,200);assert.ok(!(await first.text()).includes(env.AMAP_PUBLIC_SECURITY_JS_CODE));
  assert.equal((await call('v3/ias')).status,429);
  assert.equal((await call('v3/ias','192.0.2.2')).status,200);
  assert.equal((await call('v3/ias','192.0.2.3')).status,429);assert.equal(calls,2);
  const buckets=JSON.stringify((await env.DB.prepare('SELECT * FROM public_map_usage').all()).results);assert.ok(!buckets.includes('192.0.2.'));assert.ok(!buckets.includes('locations'));
 }finally{globalThis.fetch=original;await proxy.dispose();}
});
test('navigation preserves GCJ-02, raw GPS viewing uses WGS84, and neither carries a key',()=>{
 const place={name:'店名 & ? 测试',location:{lng:110.3,lat:25.2}};
 const [amap,baidu]=navigationLinks(place).map(x=>new URL(x.url));
 assert.equal(amap.searchParams.get('to'),'110.3,25.2,店名 & ? 测试');assert.equal(amap.searchParams.get('coordinate'),'gaode');
 assert.equal(baidu.searchParams.get('destination'),'latlng:25.2,110.3|name:店名 & ? 测试');assert.equal(baidu.searchParams.get('coord_type'),'gcj02');
 for(const link of [...navigationLinks(place),...positionLinks(110.3,25.2)]){const u=new URL(link.url);assert.equal(u.protocol,'https:');assert.ok(!u.searchParams.has('key'));assert.ok(!u.searchParams.has('jscode'));}
 assert.equal(new URL(positionLinks(110.3,25.2)[0].url).searchParams.get('coordinate'),'wgs84');
 assert.equal(new URL(positionLinks(110.3,25.2)[1].url).searchParams.get('coord_type'),'wgs84');assert.throws(()=>positionLinks(NaN,25));
 const deceptive=navigationLinks({...place,name:'店,名|latlng:0,0'}).map(x=>new URL(x.url));assert.equal(deceptive[0].searchParams.get('to').split(',').length,3);assert.equal(deceptive[1].searchParams.get('destination').split('|').length,2);
});
