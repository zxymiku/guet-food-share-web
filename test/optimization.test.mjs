import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import worker from '../src/worker.js';
import {seal} from '../src/crypto.js';
import {normalize} from '../src/validation.js';
import {placeArchive} from '../public/place-data.js';
import {discover,readCollection,writeMark,distanceKm} from '../public/discovery.js';
const food=()=>({name:'测试门店',address:'测试地址',category:'餐厅',subcategory:'面馆',pros:'快',cons:'排队',menuPrice:'面 15 元',pricePerPerson:15,businessHours:'11:00–21:00',tags:['素食可选'],location:{lng:110.3,lat:25.2,crs:'GCJ-02'},photos:[],videos:[],consent:true});
test('optional public fields survive safe archive; malformed values rejected',()=>{
 const clean=normalize({...food(),key:'private',securityJsCode:'private'}),archive=placeArchive([{...clean,id:crypto.randomUUID(),token:'secret',rating:{count:4,average:4.5}}],'https://food.test');
 for(const key of ['subcategory','pros','cons','menuPrice','pricePerPerson','businessHours','tags'])assert.deepEqual(archive.places[0][key],clean[key]);assert.ok(!JSON.stringify(archive).includes('private'));assert.ok(!JSON.stringify(archive).includes('secret'));
 for(const patch of [{pricePerPerson:-1},{pricePerPerson:10001},{tags:['x'.repeat(21)]},{tags:'bad'}])assert.throws(()=>normalize({...food(),...patch}));
});
test('private lists, budget, rating confidence, tags and distance are consistent',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const a={...food(),id:crypto.randomUUID(),rating:{count:1,average:5}},b={...food(),name:'口碑店',id:crypto.randomUUID(),pricePerPerson:30,rating:{count:30,average:4.6}};
 writeMark(storage,a.id,{favorite:true,visit:'want'});assert.equal(readCollection(storage)[a.id].visit,'want');
 assert.deepEqual(discover([a,b],{saved:'favorite'},readCollection(storage)).map(p=>p.id),[a.id]);assert.equal(discover([a,b],{sort:'rating'})[0].id,b.id);assert.equal(discover([a,b],{budget:'20'}).length,1);assert.equal(discover([a,b],{q:'素食'}).length,2);assert.equal(distanceKm(a.location,a.location),0);
 assert.deepEqual(readCollection({getItem(){throw new Error('blocked')}}),{});assert.throws(()=>writeMark({getItem:()=>null,setItem(){throw new Error('full')}},a.id,{favorite:true}));
});
test('review chronology, owner withdrawal quota, moderation and 100+ submissions',async()=>{
 const proxy=await getPlatformProxy({persist:false});
 try{
 const env={...proxy.env,APP_ORIGIN:'https://food.test',DATA_ENCRYPTION_KEY:'test-only-key-'.repeat(4),REVIEWER_GITHUB_IDS:'reviewer'};
 for(const f of (await readdir(new URL('../migrations/',import.meta.url))).sort())await env.DB.exec((await readFile(new URL('../migrations/'+f,import.meta.url),'utf8')).replace(/\n/g,' '));
 const tokens={};for(const user of ['owner','other','reviewer'])tokens[user]=await seal({user,exp:Date.now()+60000},env,'session');
 const call=(path,user='owner',method='GET',body)=>worker.fetch(new Request('https://food.test'+path,{method,headers:{Authorization:'Bearer '+tokens[user],'CF-Connecting-IP':'192.0.2.9'},body:body===undefined?undefined:JSON.stringify(body)}),env);
 const id=crypto.randomUUID(),payload=normalize(food());await env.DB.prepare('INSERT INTO places(id,payload) VALUES (?,?)').bind(id,JSON.stringify(payload)).run();
 for(let n=0;n<101;n++)await env.DB.prepare('INSERT INTO reviews(id,place_id,score,comment,day,ip_hash,device_hash,user_id,created_at) VALUES (?,?,5,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,'review '+n,'2020-01-01','ip'+n,'device'+n,'seed'+n,n===100?'2021-01-02 00:00:00':'2021-01-01 00:00:00').run();
 const first=await (await call(`/api/places/${id}/reviews`)).json();assert.equal(first.reviews.length,100);assert.equal(first.reviews[0].comment,'review 100');assert.ok(first.nextCursor);
 const last=await (await call(`/api/places/${id}/reviews?before=${encodeURIComponent(first.nextCursor)}`)).json();assert.equal(last.reviews.length,1);assert.equal(new Set([...first.reviews,...last.reviews].map(x=>x.id)).size,101);assert.ok(!JSON.stringify(first).includes('ip_hash'));
 assert.equal((await call(`/api/places/${id}/reviews?before=bad`)).status,400);
 const input={score:4,comment:'my review',deviceId:crypto.randomUUID()};assert.equal((await call(`/api/places/${id}/reviews`,'owner','POST',input)).status,201);
 const mine=(await (await call(`/api/places/${id}/reviews`)).json()).reviews.find(r=>r.canDelete);assert.ok(mine);assert.equal((await call('/api/reviews/'+mine.id,'other','DELETE')).status,403);assert.equal((await call('/api/reviews/'+mine.id,'owner','DELETE')).status,200);
 assert.equal((await call(`/api/places/${id}/reviews`,'owner','POST',{...input,deviceId:crypto.randomUUID()})).status,429);
 const report={type:'place',targetId:id,reason:'信息有误',detail:'营业时间有误'};const reported=await call('/api/reports','owner','POST',report);assert.equal(reported.status,201);const reportId=(await reported.json()).id;assert.equal((await call('/api/reports','owner','POST',report)).status,429);assert.equal((await call('/api/moderation')).status,403);
 const queue=await (await call('/api/moderation','reviewer')).json();assert.ok(queue.reports[0].target_preview.includes('测试门店'));assert.equal(queue.reports[0].user_id,undefined);
 assert.equal((await call('/api/moderation','reviewer','POST',{id:reportId,action:'hide'})).status,200);assert.equal((await call('/api/places/'+id)).status,404);assert.equal((await (await call('/api/places')).json()).places.length,0);
 assert.equal((await call('/api/moderation','reviewer','POST',{id:reportId,action:'restore'})).status,200);assert.equal((await call('/api/places/'+id)).status,200);
 const encrypted=await seal(payload,env);for(let n=0;n<103;n++)await env.DB.prepare('INSERT INTO submissions(id,user_id,payload,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),'owner',encrypted,'2021-01-01T00:00:00.000Z').run();
 const page=await (await call('/api/submissions')).json(),more=await (await call('/api/submissions?cursor='+encodeURIComponent(page.nextCursor))).json();assert.equal(page.submissions.length,100);assert.equal(more.submissions.length,3);assert.equal(new Set([...page.submissions,...more.submissions].map(x=>x.id)).size,103);
 }finally{await proxy.dispose();}
});
