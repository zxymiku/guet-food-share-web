import {applySchema} from './schema.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import worker from '../src/worker.js';
import {saveGitHubGrant} from '../src/github-user.js';
import {pbkdf2Sync} from 'node:crypto';
import {seal,encryptionKey} from '../src/crypto.js';
import {encryptedStream} from '../src/github-media.js';

test('feedback targets each platform, publishes only attached screenshots, and safely retries',async()=>{
 const proxy=await getPlatformProxy({persist:false}),network=globalThis.fetch;
 try{
  const env={...proxy.env,APP_ORIGIN:'https://feedback.test',DEV_MODE:'false',DATA_ENCRYPTION_KEY:'feedback-test-secret-'.repeat(3),GITHUB_CLIENT_ID:'test-app',GITHUB_ANDROID_REPO_ID:'11',GITHUB_WEB_REPO_ID:'12',MEDIA_GITHUB_TOKEN:'media-token',GITHUB_TOKEN:'media-token',FEEDBACK_GITHUB_TOKEN:'issue-token',GITHUB_REPO:'owner/android',FEEDBACK_WEB_REPO:'owner/web',MEDIA_REPO:'owner/media'};
  await applySchema(env.DB);
  const owner='private-user-12345',other='another-user',photo=crypto.randomUUID();
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
  const encrypted=await encryptedStream(new Response(png).body,await encryptionKey(env,'media:'+photo),photo,png.length,'image/png');
  const ciphertext=new Uint8Array(await new Response(encrypted).arrayBuffer());
  await env.DB.prepare('INSERT INTO media(id,user_id,kind,descriptor) VALUES (?,?,?,?)').bind(photo,owner,'image',await seal({assetId:99,mime:'image/png',size:png.length},env,'media-index')).run();
  await saveGitHubGrant(env,owner,{access_token:'ghu_web_user',expires_in:28800},'web');
  await saveGitHubGrant(env,owner,{access_token:'ghu_android_user',expires_in:28800},'android');
  const sharedPassword='feedback-test-password-123';env.PASSWORD_CREDENTIAL='pbkdf2-sha256$100000$'+'cd'.repeat(16)+'$'+pbkdf2Sync(sharedPassword,Buffer.from('cd'.repeat(16),'hex'),100000,32,'sha256').toString('hex');
  let mode='success',writes=0;const issues=[];
  globalThis.fetch=async(input,options={})=>{
   const url=new URL(String(input));
   if(url.hostname==='github.com'&&url.pathname==='/login/oauth/access_token'){const refresh=JSON.parse(options.body);assert.equal(refresh.grant_type,'refresh_token');assert.equal(refresh.refresh_token,'ghr_mock');return Response.json({access_token:'ghu_web_refreshed',expires_in:28800,refresh_token:'ghr_rotated',refresh_token_expires_in:1000});}
   if(url.hostname!=='api.github.com')return network(input,options);
   if(url.pathname.endsWith('/releases/assets/99')){assert.equal(options.headers.Authorization,'Bearer media-token');return new Response(ciphertext);}
   assert.ok(['Bearer issue-token','Bearer ghu_web_user','Bearer ghu_android_user','Bearer ghu_web_refreshed'].includes(options.headers.Authorization));
   if(options.method==='POST'){
    writes++;const data=JSON.parse(options.body),repo=url.pathname.split('/').slice(2,4).join('/');
    const issue={...data,actor:options.headers.Authorization,number:writes,html_url:`https://github.com/${repo}/issues/${writes}`};issues.push(issue);
    if(mode==='forbidden')return Response.json({message:'Forbidden'},{status:403});
    if(mode==='timeout')throw new TypeError('network response lost');
    return Response.json(issue,{status:201});
   }
   return Response.json(issues);
  };
  const tokens={};for(const user of [owner,other])tokens[user]=await seal({user,exp:Date.now()+60000},env,'session');
  const call=(path,{user=owner,method='GET',body,envOverride=env,headers={}}={})=>worker.fetch(new Request('https://feedback.test'+path,{method,headers:{...(user?{Authorization:'Bearer '+tokens[user]}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),envOverride);
  const draft=()=>({requestId:crypto.randomUUID(),platform:'web',title:'截图反馈',description:'点击后按钮不显示\n```\n@someone',screenshots:['/api/photos/'+photo],appVersion:'Web',consent:true});
  assert.equal((await call('/api/feedback',{user:null,method:'POST',body:draft()})).status,401);
  assert.equal((await call('/api/feedback',{method:'POST',body:{...draft(),consent:false}})).status,400);
  assert.equal((await call('/api/feedback',{method:'POST',body:{...draft(),platform:'arbitrary/repo'}})).status,400);
  assert.equal((await call('/api/feedback',{user:other,method:'POST',body:draft()})).status,403);
  const sharedLogin=await call('/api/auth/password',{user:null,method:'POST',body:{password:sharedPassword,client:'android'}});assert.equal(sharedLogin.status,200);const shared=await sharedLogin.json();tokens[shared.user]=shared.token;
  assert.equal((await call('/api/feedback',{user:shared.user,method:'POST',body:{...draft(),screenshots:[]},envOverride:{...env,FEEDBACK_GITHUB_TOKEN:'',GITHUB_TOKEN:''}})).status,503);
  assert.equal((await call('/api/feedback',{user:other,method:'POST',body:{...draft(),screenshots:[]}})).status,401);
  assert.equal((await call('/api/feedback/screenshots',{method:'POST',body:{},headers:{'Content-Type':'video/mp4'}})).status,400);
  const config=await (await call('/api/config')).json();assert.equal(config.feedback.webIssuesUrl,'https://github.com/owner/web/issues/new');assert.equal(config.feedback.androidIssuesUrl,'https://github.com/owner/android/issues/new');
  const first=draft(),response=await call('/api/feedback',{method:'POST',body:first});assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.issueUrl,'https://github.com/owner/web/issues/1');assert.equal(issues[0].title,'[Web反馈] 截图反馈');assert.equal(issues[0].actor,'Bearer ghu_web_user');assert.ok(!issues[0].body.includes(owner));
  assert.equal((await call('/api/feedback',{method:'POST',body:first})).status,200);assert.equal(writes,1);
  assert.equal((await call('/api/feedback',{method:'POST',body:{...first,title:'被修改的反馈'}})).status,409);assert.equal(writes,1);
  const imageURL=new URL(issues[0].body.match(/!\[反馈截图 1\]\(([^)]+)\)/)[1]);
  const publicImage=await call(imageURL.pathname+imageURL.search,{user:null});assert.equal(publicImage.status,200);assert.deepEqual(new Uint8Array(await publicImage.arrayBuffer()),png);
  assert.equal((await call('/api/photos/'+photo,{user:null})).status,404);
  assert.equal((await call(imageURL.pathname+'?key='+'a'.repeat(64),{user:null})).status,404);
  const stored=await env.DB.prepare('SELECT payload FROM feedback WHERE id=?').bind(first.requestId).first();assert.ok(stored.payload.startsWith('enc1.'));assert.ok(!stored.payload.includes(first.title));
  const android={...draft(),platform:'android',appVersion:'1.0.6',screenshots:[]};const androidResult=await (await call('/api/feedback',{method:'POST',body:android})).json();assert.equal(androidResult.issueUrl,'https://github.com/owner/android/issues/2');assert.equal(issues[1].actor,'Bearer ghu_android_user');
  const delegated=await call('/api/feedback',{user:shared.user,method:'POST',body:{...draft(),platform:'android',screenshots:[],repo:'attacker/elsewhere'}});assert.equal(delegated.status,201);assert.equal(issues.at(-1).actor,'Bearer issue-token');assert.ok(issues.at(-1).html_url.startsWith('https://github.com/owner/android/issues/'));
  mode='forbidden';const denied=draft();assert.equal((await call('/api/feedback',{method:'POST',body:denied})).status,503);
  const deniedURL=new URL(issues.at(-1).body.match(/!\[反馈截图 1\]\(([^)]+)\)/)[1]);assert.equal((await call(deniedURL.pathname+deniedURL.search,{user:null})).status,404);
  mode='timeout';const ambiguous={...draft(),screenshots:[]};assert.equal((await call('/api/feedback',{method:'POST',body:ambiguous})).status,409);
  await env.DB.prepare("UPDATE feedback SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE id=?").bind(ambiguous.requestId).run();
  mode='success';const before=writes;assert.equal((await call('/api/feedback',{method:'POST',body:ambiguous})).status,201);assert.equal(writes,before);
  await saveGitHubGrant(env,owner,{access_token:'ghu_expired',expires_in:-1,refresh_token:'ghr_mock',refresh_token_expires_in:1000},'web');
  const refreshed=await call('/api/feedback',{method:'POST',body:{...draft(),screenshots:[]}});assert.equal(refreshed.status,201);assert.equal(issues.at(-1).actor,'Bearer ghu_web_refreshed');
  const grant=await env.DB.prepare('SELECT payload FROM github_user_grants WHERE user_id=? AND platform=?').bind(owner,'web').first();assert.ok(grant.payload.startsWith('enc1.'));assert.ok(!grant.payload.includes('ghu_'));assert.ok(!grant.payload.includes('ghr_'));
 }finally{globalThis.fetch=network;await proxy.dispose();}
});
