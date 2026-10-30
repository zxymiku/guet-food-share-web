import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import worker from '../src/worker.js';
import {seal,encryptionKey} from '../src/crypto.js';
import {encryptedStream} from '../src/github-media.js';

test('feedback targets each platform, publishes only attached screenshots, and safely retries',async()=>{
 const proxy=await getPlatformProxy({persist:false}),network=globalThis.fetch;
 try{
  const env={...proxy.env,APP_ORIGIN:'https://feedback.test',DEV_MODE:'false',DATA_ENCRYPTION_KEY:'feedback-test-secret-'.repeat(3),GITHUB_TOKEN:'media-token',FEEDBACK_GITHUB_TOKEN:'issue-token',GITHUB_REPO:'owner/android',FEEDBACK_WEB_REPO:'owner/web',MEDIA_REPO:'owner/media'};
  for(const migration of ['0001_init.sql','0002_media.sql','0003_feedback.sql'])await env.DB.exec((await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8')).replace(/\n/g,' '));
  const owner='private-user-12345',other='another-user',photo=crypto.randomUUID();
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
  const encrypted=await encryptedStream(new Response(png).body,await encryptionKey(env,'media:'+photo),photo,png.length,'image/png');
  const ciphertext=new Uint8Array(await new Response(encrypted).arrayBuffer());
  await env.DB.prepare('INSERT INTO media(id,user_id,kind,descriptor) VALUES (?,?,?,?)').bind(photo,owner,'image',await seal({assetId:99,mime:'image/png',size:png.length},env,'media-index')).run();
  let mode='success',writes=0;const issues=[];
  globalThis.fetch=async(input,options={})=>{
   const url=new URL(String(input));
   if(url.hostname!=='api.github.com')return network(input,options);
   if(url.pathname.endsWith('/releases/assets/99')){assert.equal(options.headers.Authorization,'Bearer media-token');return new Response(ciphertext);}
   assert.equal(options.headers.Authorization,'Bearer issue-token');
   if(options.method==='POST'){
    writes++;const data=JSON.parse(options.body),repo=url.pathname.split('/').slice(2,4).join('/');
    const issue={...data,number:writes,html_url:`https://github.com/${repo}/issues/${writes}`};issues.push(issue);
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
  assert.equal((await call('/api/feedback',{method:'POST',body:draft(),envOverride:{...env,FEEDBACK_GITHUB_TOKEN:'',GITHUB_TOKEN:''}})).status,503);
  assert.equal((await call('/api/feedback/screenshots',{method:'POST',body:{},headers:{'Content-Type':'video/mp4'}})).status,400);
  const config=await (await call('/api/config')).json();assert.equal(config.feedback.webIssuesUrl,'https://github.com/owner/web/issues/new');assert.equal(config.feedback.androidIssuesUrl,'https://github.com/owner/android/issues/new');
  const first=draft(),response=await call('/api/feedback',{method:'POST',body:first});assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.issueUrl,'https://github.com/owner/web/issues/1');assert.equal(issues[0].title,'[Web反馈] 截图反馈');assert.ok(!issues[0].body.includes(owner));
  assert.equal((await call('/api/feedback',{method:'POST',body:first})).status,200);assert.equal(writes,1);
  assert.equal((await call('/api/feedback',{method:'POST',body:{...first,title:'被修改的反馈'}})).status,409);assert.equal(writes,1);
  const imageURL=new URL(issues[0].body.match(/!\[反馈截图 1\]\(([^)]+)\)/)[1]);
  const publicImage=await call(imageURL.pathname+imageURL.search,{user:null});assert.equal(publicImage.status,200);assert.deepEqual(new Uint8Array(await publicImage.arrayBuffer()),png);
  assert.equal((await call('/api/photos/'+photo,{user:null})).status,404);
  assert.equal((await call(imageURL.pathname+'?key='+'a'.repeat(64),{user:null})).status,404);
  const stored=await env.DB.prepare('SELECT payload FROM feedback WHERE id=?').bind(first.requestId).first();assert.ok(stored.payload.startsWith('enc1.'));assert.ok(!stored.payload.includes(first.title));
  const android={...draft(),platform:'android',appVersion:'1.0.6',screenshots:[]};const androidResult=await (await call('/api/feedback',{method:'POST',body:android})).json();assert.equal(androidResult.issueUrl,'https://github.com/owner/android/issues/2');
  mode='forbidden';const denied=draft();assert.equal((await call('/api/feedback',{method:'POST',body:denied})).status,503);
  const deniedURL=new URL(issues.at(-1).body.match(/!\[反馈截图 1\]\(([^)]+)\)/)[1]);assert.equal((await call(deniedURL.pathname+deniedURL.search,{user:null})).status,404);
  mode='timeout';const ambiguous={...draft(),screenshots:[]};assert.equal((await call('/api/feedback',{method:'POST',body:ambiguous})).status,409);
  await env.DB.prepare("UPDATE feedback SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE id=?").bind(ambiguous.requestId).run();
  mode='success';const before=writes;assert.equal((await call('/api/feedback',{method:'POST',body:ambiguous})).status,201);assert.equal(writes,before);
 }finally{globalThis.fetch=network;await proxy.dispose();}
});
