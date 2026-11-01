import {applySchema} from './schema.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import {reviews} from '../src/reviews.js';
import {validateCategories,fallback} from '../src/categories.js';
import {normalize} from '../src/validation.js';
import {seal} from '../src/crypto.js';
import worker from '../src/worker.js';
test('configuration rejects malformed input and optional fields exclude secrets',()=>{
 assert.equal(validateCategories(fallback),fallback);
 for(const config of [{},{version:1,categories:[]},{version:1,categories:[{name:'餐厅',children:['重复','重复']}]}])assert.throws(()=>validateCategories(config));
 const clean=normalize({name:'测试',address:'测试地址',category:'餐厅',subcategory:'面馆',pros:'便宜',cons:'排队',menuPrice:'面 ¥15',location:{lng:110,lat:25,crs:'GCJ-02',key:'private'},consent:true,key:'private'},fallback);
 assert.equal(clean.menuPrice,'面 ¥15');assert.ok(!JSON.stringify(clean).includes('private'));
});
test('D1 atomically rejects repeated IP OR device, permits other places; deletion checks owner and blocks republish',async()=>{
 const proxy=await getPlatformProxy({persist:false});
 try{
 const env={...proxy.env,APP_ORIGIN:'https://food.test',DATA_ENCRYPTION_KEY:'test-secret-'.repeat(4),PUBLISH_SECRET:'test-publish'};
 await applySchema(env.DB);
 const id=crypto.randomUUID(),other=crypto.randomUUID();
 const payload={name:'测试',address:'测试地址',category:'餐厅',location:{lng:110,lat:25,crs:'GCJ-02'},consent:true};
 await env.DB.prepare('INSERT INTO submissions(id,user_id,payload) VALUES (?,?,?)').bind(id,'owner',await seal(payload,env)).run();
 for(const place of [id,other])await env.DB.prepare('INSERT INTO places(id,payload) VALUES (?,?)').bind(place,JSON.stringify(payload)).run();
 const request=ip=>new Request('https://food.test/api/places/'+id+'/reviews',{method:'POST',headers:{'CF-Connecting-IP':ip}});
 const input={score:5,comment:'测试评价',deviceId:crypto.randomUUID()};
 assert.equal((await reviews(request('1.1.1.1'),env,id,'u',input)).status,201);
 assert.equal((await reviews(request('1.1.1.1'),env,id,'u',{...input,deviceId:crypto.randomUUID()})).status,429);
 assert.equal((await reviews(request('2.2.2.2'),env,id,'u',input)).status,429);
 assert.equal((await reviews(request('1.1.1.1'),env,other,'u',input)).status,201);
 const publicRows=await (await reviews(new Request('https://food.test/api/places/'+id+'/reviews'),env,id,null,null)).text();
 assert.ok(!publicRows.includes('ip_hash'));assert.ok(!publicRows.includes(input.deviceId));
 const del=async user=>worker.fetch(new Request('https://food.test/api/submissions/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+await seal({user,exp:Date.now()+60000},env,'session')}}),env);
 assert.equal((await del('intruder')).status,403);assert.equal((await del('owner')).status,200);
 assert.equal(await env.DB.prepare('SELECT id FROM places WHERE id=?').bind(id).first(),null);
 const result=await worker.fetch(new Request('https://food.test/api/internal/publish/'+id,{method:'POST',headers:{Authorization:'Bearer test-publish','Content-Type':'application/json'},body:JSON.stringify(payload)}),env);
 assert.equal(result.status,200);assert.equal((await result.json()).deleted,true);
 }finally{await proxy.dispose();}
});
