import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import {seal} from '../src/crypto.js';
import worker from '../src/worker.js';
const password='test-only-shared-password-123';
const verifier=value=>'pbkdf2-sha256$100000$'+'ab'.repeat(16)+'$'+pbkdf2Sync(value,Buffer.from('ab'.repeat(16),'hex'),100000,32,'sha256').toString('hex');
test('shared password has upload/read-only authority, isolated ownership, rotation and throttling',async()=>{
 const proxy=await getPlatformProxy({persist:false});
 try{
  const env={...proxy.env,APP_ORIGIN:'https://food.test',DEV_MODE:'false',DATA_ENCRYPTION_KEY:'password-test-key-'.repeat(3),PASSWORD_CREDENTIAL:verifier(password),GITHUB_REPO:'',GITHUB_TOKEN:'',DISPATCH_GITHUB_TOKEN:'',MEDIA_GITHUB_TOKEN:'',FEEDBACK_GITHUB_TOKEN:''};
  for(const name of ['0001_init.sql','0002_media.sql','0003_feedback.sql','0004_password_login.sql'])await env.DB.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/\n/g,' '));
  const call=(path,{method='GET',body,cookie='',bearer='',ip='192.0.2.1',override=env}={})=>worker.fetch(new Request('https://food.test'+path,{method,headers:{Cookie:cookie,'CF-Connecting-IP':ip,...bearer?{Authorization:'Bearer '+bearer}:{}},body:body===undefined?undefined:JSON.stringify(body)}),override);
  const login=options=>call('/api/auth/password',{method:'POST',body:{password,client:'web'},...options});
  const cookies=r=>r.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
  assert.equal((await login({override:{...env,PASSWORD_CREDENTIAL:''}})).status,503);
  assert.equal((await login({body:{password:'wrong-password-at-least-12'}})).status,401);
  const response=await login({body:{password,client:'web',role:'admin',user:'95949338'}});assert.equal(response.status,200);
  const auth=await response.json(),browserCookie=cookies(response);assert.ok(auth.user.startsWith('credential:'));assert.equal(auth.role,'contributor');assert.equal(auth.token,undefined);assert.equal(auth.deviceToken,undefined);assert.ok(response.headers.getSetCookie().every(c=>c.includes('HttpOnly')&&c.includes('Secure')));
  env.REVIEWER_GITHUB_IDS=auth.user; // Even an accidental reviewer-list entry cannot elevate a password session.
  const me=await (await call('/api/me',{cookie:browserCookie})).json();assert.equal(me.reviewer,false);assert.equal(me.authType,'credential');assert.deepEqual(me.permissions,['food:read','food:submit','media:upload','feedback:submit']);
  const id=crypto.randomUUID();
  for(const [path,method] of [[`/api/submissions/${id}`,'DELETE'],[`/api/media/${id}`,'DELETE'],[`/api/submissions/${id}`,'PUT'],[`/api/review/${id}`,'GET'],[`/api/internal/publish/${id}`,'POST'],['/api/feedback','DELETE'],['/api/admin','GET']])assert.equal((await call(path,{cookie:browserCookie,method,body:method==='GET'?undefined:{}})).status,403,path);
  await env.DB.prepare('INSERT INTO media(id,user_id,kind,descriptor) VALUES (?,?,?,?)').bind(id,'another-person','image','{}').run();assert.equal((await call('/api/photos/'+id,{cookie:browserCookie})).status,404);
  const food={name:'本地测试面馆',address:'仅测试，不是真实商家',category:'餐厅',location:{lng:110.299121,lat:25.274215,crs:'GCJ-02'},photos:[],videos:[],consent:true};
  const submit=await call('/api/submissions',{cookie:browserCookie,method:'POST',body:food});assert.equal(submit.status,201);
  const submissionId=(await submit.json()).id;env.INTAKE_SECRET='intake-test';env.PUBLISH_SECRET='publish-test';env.PIPELINE_SECRET='old-combined-secret';
  assert.equal((await call('/api/internal/submissions/'+submissionId,{bearer:env.INTAKE_SECRET})).status,200);
  assert.equal((await call('/api/internal/submissions/'+submissionId,{bearer:env.PUBLISH_SECRET})).status,401);
  assert.equal((await call('/api/internal/publish/'+submissionId,{method:'POST',bearer:env.INTAKE_SECRET,body:food})).status,401);
  assert.equal((await call('/api/internal/submissions/'+submissionId,{bearer:env.PIPELINE_SECRET})).status,401);
  assert.equal((await call('/api/internal/publish/'+submissionId,{method:'POST',bearer:env.PUBLISH_SECRET,body:food})).status,200);
  assert.equal((await (await call('/api/submissions',{cookie:browserCookie})).json()).submissions.length,1);
  assert.equal((await call('/api/places',{cookie:browserCookie})).status,200);
  assert.equal((await call('/api/photos',{cookie:browserCookie,method:'POST',body:{}})).status,400); // media configuration/validation reached, not a permission denial
  assert.equal((await call('/api/feedback',{cookie:browserCookie,method:'POST',body:{}})).status,400);
  assert.equal((await call('/api/feedback/screenshots',{cookie:browserCookie,method:'POST',body:{}})).status,400);
  const deviceCookie=browserCookie.split('; ').find(c=>c.startsWith('credential_device='));
  assert.equal((await call('/api/logout',{cookie:browserCookie,method:'POST',body:{}})).status,200);
  const again=await login({cookie:deviceCookie});assert.equal((await again.json()).user,auth.user);
  const nativeResponse=await login({body:{password,client:'android'}});const native=await nativeResponse.json();assert.ok(native.token&&native.deviceToken);assert.notEqual(native.user,auth.user);
  assert.equal((await (await call('/api/submissions',{bearer:native.token})).json()).submissions.length,0);
  const nativeAgain=await (await login({body:{password,client:'android',deviceToken:native.deviceToken}})).json();assert.equal(nativeAgain.user,native.user);
  env.PASSWORD_CREDENTIAL=verifier('replacement-password-456');
  assert.equal((await (await call('/api/me',{cookie:browserCookie})).json()).user,null);
  assert.equal((await call('/api/submissions',{cookie:browserCookie,method:'POST',body:food})).status,401);
  const rotated=await login({cookie:deviceCookie,body:{password:'replacement-password-456',client:'web'}});assert.equal(rotated.status,200);assert.equal((await rotated.json()).user,auth.user);
  for(let i=0;i<20;i++)assert.equal((await login({ip:'198.51.100.17',body:{password:'another-wrong-password'}})).status,401);
  const blocked=await login({ip:'198.51.100.17',body:{password:'replacement-password-456'}});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>0);
  const buckets=await env.DB.prepare('SELECT bucket_key FROM password_login_attempts').all();assert.ok(buckets.results.every(r=>/^[a-f0-9]{64}$/.test(r.bucket_key)));
  const configuration=await (await call('/api/config')).text();assert.ok(!configuration.includes(env.PASSWORD_CREDENTIAL));assert.ok(!configuration.includes('replacement-password-456'));
  env.GITHUB_CLIENT_ID='test-client';const oauth=await call('/auth/github');assert.equal(oauth.status,302);assert.equal(new URL(oauth.headers.get('Location')).searchParams.has('scope'),false);
 }finally{await proxy.dispose();}
});
