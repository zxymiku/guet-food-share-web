import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env={APP_ORIGIN:'https://food.test',DATA_ENCRYPTION_KEY:'a'.repeat(32)};
const req=(path,options={})=>new Request('https://food.test'+path,options);
test('anonymous uploads and submissions require login',async()=>{for(const path of ['/api/photos','/api/submissions'])assert.equal((await worker.fetch(req(path,{method:'POST'}),env)).status,401);});
test('local bypass is inaccessible on public hosts even with DEV_MODE',async()=>{assert.equal((await worker.fetch(req('/api/dev-session',{method:'POST'}),{...env,DEV_MODE:'true'})).status,404);});
test('cross-origin writes are blocked',async()=>{assert.equal((await worker.fetch(req('/api/submissions',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);});
test('pipeline endpoints reject missing or wrong secret',async()=>{for(const headers of [{},{Authorization:'Bearer bad'}])assert.equal((await worker.fetch(req('/api/internal/publish/11111111-1111-1111-1111-111111111111',{method:'POST',headers}),{...env,PIPELINE_SECRET:'valid'})).status,401);});
test('tampered session cannot authenticate',async()=>{const r=await worker.fetch(req('/api/me',{headers:{Cookie:'session=abcd.efgh'}}),env);assert.deepEqual(await r.json(),{user:null,reviewer:false,authType:null,permissions:[]});});
test('mobile verifier is validated before database access',async()=>{const r=await worker.fetch(req('/api/mobile/token',{method:'POST',body:JSON.stringify({code:'test',verifier:'invalid'})}),env);assert.equal(r.status,400);});
test('unknown API routes never return the SPA',async()=>{const r=await worker.fetch(req('/api/unknown'),env);assert.equal(r.status,404);assert.match(r.headers.get('Content-Type'),/json/);});
test('server map credentials are never exposed by config',async()=>{const r=await worker.fetch(req('/api/config'),{...env,AMAP_WEB_KEY:'public-key',AMAP_SECURITY_JS_CODE:'secret-code'});const raw=await r.text();assert.ok(!raw.includes('public-key'));assert.ok(!raw.includes('secret-code'));});
test('map proxy refuses arbitrary upstream paths',async()=>{assert.equal((await worker.fetch(req('/_AMapService/private'),{...env,AMAP_SECURITY_JS_CODE:'secret'})).status,410);});

test('README is embeddable only on same origin',async()=>{
 const e={...env,ASSETS:{fetch:async()=>new Response('<h1>README</h1>')}};
 assert.equal((await worker.fetch(req('/amap-guide.html'),e)).headers.get('X-Frame-Options'),'SAMEORIGIN');
 assert.equal((await worker.fetch(req('/'),e)).headers.get('X-Frame-Options'),'DENY');
});
