// One focused integration pass: ephemeral D1 and mocked GitHub media, no real account writes.
import {getPlatformProxy} from 'wrangler';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const proxy=await getPlatformProxy({persist:false});
const networkFetch=globalThis.fetch,mediaAssets=new Map(),releases=new Map();let nextAsset=1;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input)),method=options.method||'GET';
 if(url.hostname==='uploads.github.com'){
  const bytes=new Uint8Array(await new Response(options.body).arrayBuffer()),id=nextAsset++;mediaAssets.set(id,bytes);return Response.json({id,size:bytes.length});
 }
 if(url.hostname==='api.github.com'&&url.pathname.includes('/guet-food-share-media/')){
  if(url.pathname.includes('/releases/tags/'))return releases.has(url.pathname.split('/').at(-1))?Response.json(releases.get(url.pathname.split('/').at(-1))):Response.json({}, {status:404});
  if(method==='POST'&&url.pathname.endsWith('/releases')){const body=JSON.parse(options.body);const value={id:1,assets:[],upload_url:'https://uploads.github.com/repos/test/guet-food-share-media/releases/1/assets{?name}'};releases.set(body.tag_name,value);return Response.json(value);}
  if(url.pathname.includes('/releases/assets/')){const bytes=mediaAssets.get(Number(url.pathname.split('/').at(-1)));return new Response(bytes,{status:bytes?200:404});}
 }
 return networkFetch(input,options);
};
try {
 const env={...proxy.env,DEV_MODE:'true',APP_ORIGIN:'http://localhost:8787',DATA_ENCRYPTION_KEY:'local-test-secret-'.repeat(3),PIPELINE_SECRET:'pipeline-test',MEDIA_GITHUB_TOKEN:'mock-media-token',GITHUB_TOKEN:'mock-media-token',DISPATCH_GITHUB_TOKEN:'',GITHUB_WEB_REPO_ID:'12',GITHUB_ANDROID_REPO_ID:'11',GITHUB_REPO:'',MEDIA_REPO:'test/guet-food-share-media'};
 await env.DB.exec((await readFile(new URL('../migrations/0001_init.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
 await env.DB.exec((await readFile(new URL('../migrations/0002_media.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
 for(const name of ['0003_feedback.sql','0004_password_login.sql','0005_github_user_grants.sql'])await env.DB.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/\n/g,' '));
 let session='';
 const call=async(path,method='GET',data,headers={})=>worker.fetch(new Request('http://localhost:8787'+path,{method,headers:{...(session?{Cookie:session}:{}),...headers},body:data===undefined?undefined:typeof data==='string'?data:JSON.stringify(data)}),env);
 assert.equal((await call('/api/submissions','POST',{})).status,401);
 const login=await call('/api/dev-session','POST',{});assert.equal(login.status,200);session=login.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await (await call('/api/me')).json()).user,'local-developer');
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
 const upload=await worker.fetch(new Request('http://localhost:8787/api/photos',{method:'POST',headers:{Cookie:session,'Content-Type':'image/png','X-File-Size':String(png.length)},body:png}),env);assert.equal(upload.status,201);const {url:photo}=await upload.json();assert.notDeepEqual(mediaAssets.get(1),png);
 assert.deepEqual(new Uint8Array(await (await call(photo)).arrayBuffer()),png);const saved=session;session='';assert.equal((await call(photo)).status,404);session=saved;
 const clip=new Uint8Array(600000);clip.set([0,0,0,24,102,116,121,112,105,115,111,109]);clip.fill(7,12);
 const videoUpload=await worker.fetch(new Request('http://localhost:8787/api/media',{method:'POST',headers:{Cookie:session,'Content-Type':'video/mp4','X-File-Size':String(clip.length)},body:clip}),env);assert.equal(videoUpload.status,201);const video=(await videoUpload.json()).url;
 const seek=await call(video,'GET',undefined,{Range:'bytes=260000-270000'});assert.equal(seek.status,206);assert.deepEqual(new Uint8Array(await seek.arrayBuffer()),clip.slice(260000,270001));
 const payload={name:'  测试面馆  ',category:'面馆',address:'本地测试，不是真实门店',description:'<script>alert(1)</script>',directions:'步行前往',location:{lng:116.397428,lat:39.909230,crs:'GCJ-02'},photos:[photo],videos:[video],consent:true};
 assert.equal((await call('/api/submissions','POST',{...payload,location:null})).status,400);
 assert.equal((await call('/api/submissions','POST',{...payload,photos:['/api/photos/11111111-1111-1111-1111-111111111111']})).status,403);
 const result=await call('/api/submissions','POST',payload);assert.equal(result.status,201);const record=await result.json();assert.equal(record.status,'pending');const stored=await env.DB.prepare('SELECT payload FROM submissions WHERE id=?').bind(record.id).first();assert.ok(stored.payload.startsWith('enc1.'));assert.ok(!stored.payload.includes('测试面馆'));
 assert.equal((await (await call('/api/places')).json()).places.length,0);
 assert.equal((await (await call('/api/submissions')).json()).submissions.length,1);
 assert.equal((await call(`/api/submissions/${record.id}/retry`,'POST',{})).status,503);
 const admin={Authorization:'Bearer pipeline-test'};
 const intake=await (await call('/api/internal/submissions/'+record.id,'GET',undefined,admin)).json();assert.equal(intake.name,'测试面馆');
 assert.equal((await call('/api/internal/publish/'+record.id,'POST',{...intake,name:'篡改店名'},admin)).status,409);
 assert.equal((await call('/api/internal/publish/'+record.id,'POST',intake,admin)).status,200);
 assert.equal((await call('/api/internal/publish/'+record.id,'POST',intake,admin)).status,200);
 session='';assert.equal((await call(photo)).status,200);const places=await (await call('/api/places')).json();assert.equal(places.places.length,1);assert.equal(places.places[0].description,payload.description);
 session=saved;assert.equal((await (await call('/api/submissions')).json()).submissions[0].status,'published');
 // OAuth + native PKCE with a mocked GitHub boundary, no real account traffic.
 env.GITHUB_CLIENT_ID='test-client';env.GITHUB_CLIENT_SECRET='test-secret';
 const verifier='v'.repeat(43),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const auth=await call('/auth/github?challenge='+challenge);assert.equal(auth.status,302);
 const state=new URL(auth.headers.get('Location')).searchParams.get('state');
 assert.equal((await call('/auth/callback?state='+state+'&code=fake')).status,403);
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>{if(String(url)==='https://github.com/login/oauth/access_token')return Response.json({access_token:'ghu_mock',expires_in:28800});if(String(url)==='https://api.github.com/user')return Response.json({id:9999});throw new Error('Unexpected outbound request');};
 let callback;
 try{callback=await call('/auth/callback?state='+state+'&code=fake','GET',undefined,{Cookie:'oauth_state='+state});}finally{globalThis.fetch=realFetch;}
 assert.equal(callback.status,302);const mobileCode=new URL(callback.headers.get('Location')).searchParams.get('code');
 assert.equal((await call('/api/mobile/token','POST',{code:mobileCode,verifier:'x'.repeat(43)})).status,403);
 const mobile=await call('/api/mobile/token','POST',{code:mobileCode,verifier});assert.equal(mobile.status,200);const bearer=(await mobile.json()).token;
 assert.equal((await call('/api/mobile/token','POST',{code:mobileCode,verifier})).status,403);
 const identity=await call('/api/me','GET',undefined,{Authorization:'Bearer '+bearer});assert.equal((await identity.json()).user,'9999');
 assert.equal((await call('/api/review/'+record.id)).status,403);
 env.REVIEWER_GITHUB_IDS='local-developer';assert.equal((await call('/api/review/'+record.id)).status,200);
 assert.equal((await call('/api/review/'+record.id,'GET',undefined,{Authorization:'Bearer '+bearer})).status,403);
 console.log('D1/GitHub encrypted media integration passed: login, upload, photo isolation, mandatory location, ownership, pending intake, retry, review protection, idempotent publication, public photo access.');
 console.log('OAuth/PKCE integration passed: state cookie, mocked provider callback, wrong verifier rejection, single-use code, native bearer session, reviewer authorization.');
} finally {globalThis.fetch=networkFetch;await proxy.dispose();}
