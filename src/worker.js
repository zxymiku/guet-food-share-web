import {categoryConfig} from './categories.js';
import {reviews} from './reviews.js';
import {normalize, InputError} from './validation.js';
import {listPlaces} from './places.js';
import {seal,unseal} from './crypto.js';
import {uploadMedia,serveMedia} from './github-media.js';
import {appUpdate} from './app-update.js';
import {feedbackConfig,submitFeedback,feedbackScreenshot} from './feedback.js';
import {identity,passwordReady,passwordLogin,credentialAllowed} from './password-auth.js';
import {saveGitHubGrant,GitHubAuthorizationError} from './github-user.js';

const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...headers}});
const fail = (message, status = 400) => json({error: message}, status);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const local = req => ['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname);
const dev = (req, env) => env.DEV_MODE === 'true' && local(req);
const cookie = (req, key) => (req.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1);
const cookieHeader = (req, name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
async function token(user,env){return seal({user,exp:Date.now()+7*86400000},env,'session');}
async function body(req, max = 20000) {
  if (Number(req.headers.get('Content-Length')) > max) throw new InputError('请求内容过大');
  const reader = req.body?.getReader(); if (!reader) throw new InputError('请求为空');
  const chunks=[]; let total=0;
  while (true) {const {done,value}=await reader.read(); if(done) break; total+=value.length; if(total>max){await reader.cancel();throw new InputError('请求内容过大');} chunks.push(value);}
  const all=new Uint8Array(total); let offset=0; for(const c of chunks){all.set(c,offset);offset+=c.length;} return all;
}
async function readJson(req) { try {return JSON.parse(new TextDecoder().decode(await body(req)));} catch(e) {throw new InputError(e instanceof InputError ? e.message : 'JSON 格式错误');} }
async function github(env, path, payload) {
  const response = await fetch(`https://api.github.com${path}`, {method:'POST', headers:{Authorization:`Bearer ${env.DISPATCH_GITHUB_TOKEN||env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json','User-Agent':'guet-food-share','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(payload)});
  if(!response.ok) throw new Error(`GitHub ${response.status}`);
}
function repoReady(env){return /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || '') && !!(env.DISPATCH_GITHUB_TOKEN||env.GITHUB_TOKEN);}
const reviewer = (user,env) => !!user && !user.startsWith('credential:') && (env.REVIEWER_GITHUB_IDS||'').split(',').map(x=>x.trim()).includes(user);
async function dispatch(env,id){await github(env,`/repos/${env.GITHUB_REPO}/dispatches`,{event_type:'food-submitted',client_payload:{id}});await env.DB.prepare("UPDATE submissions SET status='queued' WHERE id=? AND status='pending'").bind(id).run();}
async function routes(req, env) {
  const url = new URL(req.url), path = url.pathname, method = req.method;
  const allowedOrigins=[env.APP_ORIGIN,...(env.ALLOWED_ORIGINS||'').split(',')].filter(Boolean);
  if (allowedOrigins.length && !dev(req, env) && !allowedOrigins.includes(url.origin)) return fail('访问域名未配置',403);
  if (!['GET','HEAD'].includes(method) && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin) return fail('来源不受信任',403);
  const auth=await identity(req,env),user=auth?.user||null;
  if(auth?.kind==='credential'&&path.startsWith('/api/')&&!credentialAllowed(method,path))return fail('密码凭证允许查看、上传美食和提交反馈，不允许删除、审核或管理',403);
  if(path==='/api/auth/password'&&method==='POST')return passwordLogin(req,env,await readJson(req));
  if(path==='/api/categories' && method==='GET')return json(await categoryConfig(req,env));
  const reviewMatch=/^\/api\/places\/([0-9a-f-]{36})\/reviews$/.exec(path);
  if(reviewMatch && ['GET','POST'].includes(method))return reviews(req,env,reviewMatch[1],user,method==='POST'?await readJson(req):null);
  const deleteMatch=/^\/api\/submissions\/([0-9a-f-]{36})$/.exec(path);
  if(deleteMatch && method==='DELETE'){
    if(!user)return fail('请先登录',401);
    const id=deleteMatch[1];
    if(!await env.DB.prepare('SELECT id FROM submissions WHERE id=? AND user_id=?').bind(id,user).first())return fail('只能删除自己的投稿',403);
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO deleted_submissions(id) VALUES (?)').bind(id),env.DB.prepare('DELETE FROM reviews WHERE place_id=?').bind(id),env.DB.prepare('DELETE FROM places WHERE id=?').bind(id),env.DB.prepare('DELETE FROM submissions WHERE id=? AND user_id=?').bind(id,user)]);
    return json({ok:true});
  }
  if (path === '/api/config') return json({mapCredentials:'personal',mapGuide:'/amap-guide.html',dev:dev(req,env),githubReady:repoReady(env),loginReady:!!env.GITHUB_CLIENT_ID,passwordReady:passwordReady(env),feedback:feedbackConfig(env)});
  if(path==='/api/feedback'&&method==='POST'){
    if(!user)return fail('请先登录后自动反馈；也可选择手动反馈',401);
    return submitFeedback(req,env,user,await readJson(req));
  }
  if(path==='/api/feedback/screenshots'&&method==='POST'){
    if(!user)return fail('请先登录后上传反馈截图',401);
    if(!['image/jpeg','image/png'].includes(req.headers.get('Content-Type')?.split(';')[0]))return fail('反馈截图仅支持 JPEG / PNG');
    return json(await uploadMedia(req,env,user),201);
  }
  const feedbackImage=/^\/api\/feedback\/([0-9a-f-]{36})\/screenshots\/([0-9a-f-]{36})$/.exec(path);
  if(feedbackImage&&method==='GET')return feedbackScreenshot(req,env,feedbackImage[1],feedbackImage[2]);
  if((path==='/api/app-update'||path==='/download/android'||/^\/api\/app-download\/\d+$/.test(path))&&method==='GET')return appUpdate(req,env);
  // Personal map keys never transit through this service, including legacy routes.
  if(path==='/api/location'||path.startsWith('/_AMapService/'))return fail('请在设备上配置自己的高德 API；地图与地址解析直接连接高德，本站不接收个人 Key。',410);
  if(path === '/auth/github' && method==='GET') {
    if(!env.GITHUB_CLIENT_ID) return fail('请先配置 GitHub OAuth App',503);
    const challenge=url.searchParams.get('challenge');
    if(challenge && !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('无效登录参数');
    const state=crypto.randomUUID();
    await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO oauth_states VALUES (?,?,?)').bind(state,Date.now()+600000,challenge).run();
    const target=new URL('https://github.com/login/oauth/authorize'); target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',state}).toString();
    return new Response(null,{status:302,headers:{Location:target.toString(),'Set-Cookie':cookieHeader(req,'oauth_state',state,600)}});
  }
  if(path === '/auth/callback') {
    const state=url.searchParams.get('state');
    if(!state || cookie(req,'oauth_state')!==state) return fail('登录校验失败，请重新登录',403);
    const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING *').bind(state,Date.now()).first();
    if(!row || !url.searchParams.get('code')) return fail('登录已过期或取消',403);
    const platform=row.mobile_challenge?'android':'web',repositoryId=platform==='web'?env.GITHUB_WEB_REPO_ID:env.GITHUB_ANDROID_REPO_ID;
    if(!/^\d+$/.test(repositoryId||''))return fail('请先配置对应平台的 GitHub 仓库数字 ID',503);
    const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:url.origin+'/auth/callback',repository_id:repositoryId})});
    const access=await exchange.json(); if(!access.access_token) return fail('GitHub 登录失败',502);
    const profile=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${access.access_token}`,'User-Agent':'guet-food-share'}}); if(!profile.ok) return fail('无法获取登录信息',502);
    const p=await profile.json(), user=String(p.id);
    await saveGitHubGrant(env,user,access,platform);
    if(row.mobile_challenge) {
      const code=crypto.randomUUID();
      await env.DB.prepare('DELETE FROM mobile_codes WHERE expires_at < ?').bind(Date.now()).run();
      await env.DB.prepare('INSERT INTO mobile_codes VALUES (?,?,?,?)').bind(code,user,row.mobile_challenge,Date.now()+120000).run();
      return new Response(null,{status:302,headers:{Location:'guetfood://login?code='+code,'Cache-Control':'no-store'}});
    }
    return new Response(null,{status:302,headers:{Location:'/', 'Set-Cookie':cookieHeader(req,'session',await token(user,env),604800)}});
  }
  if(path === '/api/mobile/token' && method==='POST') {
    const {code,verifier}=await readJson(req);
    if(typeof verifier!=='string'|| !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) || typeof code!=='string') return fail('登录参数错误');
    const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier)));
    const row=await env.DB.prepare('DELETE FROM mobile_codes WHERE code=? AND challenge=? AND expires_at>? RETURNING *').bind(code,challenge,Date.now()).first();
    return row ? json({token:await token(row.user_id,env)}) : fail('登录凭证无效',403);
  }
  if(path === '/api/dev-session' && method==='POST') {
    if(!dev(req,env)) return fail('Not found',404);
    return json({ok:true},200,{'Set-Cookie':cookieHeader(req,'session',await token('local-developer',env),604800)});
  }
  if(path === '/api/logout' && method==='POST') return json({ok:true},200,{'Set-Cookie':cookieHeader(req,'session','',0)});
  if(path === '/api/me') {return json({user,reviewer:reviewer(user,env),authType:auth?.kind||null,permissions:user?['food:read','food:submit','media:upload','feedback:submit']:[]});}
  if(/^\/api\/review\/[0-9a-f-]{36}$/.test(path) && method==='GET') {
    if(!reviewer(user,env))return fail('请以配置的审核员 GitHub 账号登录',403);
    const row=await env.DB.prepare('SELECT id,payload,status FROM submissions WHERE id=?').bind(path.split('/').at(-1)).first();
    return row?json({id:row.id,status:row.status,...await unseal(row.payload,env)}):fail('Not found',404);
  }
  if(path === '/api/places' && method==='GET') {
    return json(await listPlaces(env.DB,url),200,{'Access-Control-Allow-Origin':'*'});
  }
  if(path.startsWith('/api/internal/')) {
    const secret=path.startsWith('/api/internal/submissions/')&&method==='GET'?(env.INTAKE_SECRET||env.PIPELINE_SECRET):path.startsWith('/api/internal/publish/')&&method==='POST'?(env.PUBLISH_SECRET||env.PIPELINE_SECRET):null;
    if(!secret || req.headers.get('Authorization')!==`Bearer ${secret}`) return fail('Unauthorized',401);
    const id=path.split('/').at(-1); if(!/^[0-9a-f-]{36}$/.test(id)) return fail('ID 无效');
    if(path.startsWith('/api/internal/submissions/') && method==='GET') {
      const row=await env.DB.prepare('SELECT id,payload FROM submissions WHERE id=?').bind(id).first();
      return row ? json({id:row.id,...await unseal(row.payload,env)}) : fail('Not found',404);
    }
    if(path.startsWith('/api/internal/publish/') && method==='POST') {
      const raw=await readJson(req), data=normalize(raw, {categories:[{name:raw.category,children:[raw.subcategory||'']}]});
      if(await env.DB.prepare('SELECT id FROM deleted_submissions WHERE id=?').bind(id).first())return json({ok:true,deleted:true});
      const row=await env.DB.prepare('SELECT payload FROM submissions WHERE id=?').bind(id).first();
      if(!row) return fail('投稿不存在',404);
      if(JSON.stringify(normalize(await unseal(row.payload,env),{categories:[{name:data.category,children:[data.subcategory||'']}]}))!==JSON.stringify(data)) return fail('审核数据与原投稿不一致，请重新投稿后审核',409);
      await env.DB.batch([env.DB.prepare('INSERT INTO places(id,payload) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM deleted_submissions WHERE id=?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind(id,JSON.stringify(data),id),env.DB.prepare("UPDATE submissions SET status='published' WHERE id=?").bind(id)]);
      return json({ok:true});
    }
    return fail('Not found',404);
  }
  if((path.startsWith('/api/photos/')||path.startsWith('/api/media/'))&&method==='GET') {
    const id=path.split('/').at(-1);if(!/^[0-9a-f-]{36}$/.test(id))return fail('Not found',404);
    const row=await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first();if(!row)return fail('Not found',404);

    const visible=await env.DB.prepare("SELECT 1 FROM places,json_each(places.payload,?) WHERE json_each.value=? LIMIT 1").bind(row.kind==='video'?'$.videos':'$.photos',path).first();
    if(!visible&&row.user_id!==user&&!reviewer(user,env))return fail('Not found',404);
    return serveMedia(req,env,row);
  }
  if((path==='/api/photos'||path==='/api/media')&&method==='POST'){
    if(!user)return fail('请先登录',401);
    return json(await uploadMedia(req,env,user),201);
  }
  if(path === '/api/submissions') {
     if(!user) return fail('请先登录',401);
    if(method==='GET') {const rows=await env.DB.prepare('SELECT id,status,created_at,payload FROM submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user).all();return json({submissions:await Promise.all(rows.results.map(async r=>({id:r.id,status:r.status,createdAt:r.created_at,name:(await unseal(r.payload,env)).name})))});}
    if(method==='POST') {
      const data=normalize(await readJson(req),await categoryConfig(req,env));
      const count=await env.DB.prepare("SELECT count(*) AS n FROM submissions WHERE user_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')").bind(user).first();if(count.n>=10) return fail('今日投稿次数已达上限',429);
      for(const p of [...data.photos,...data.videos]){if(!await env.DB.prepare('SELECT 1 FROM media WHERE id=? AND user_id=? AND kind=?').bind(p.split('/').at(-1),user,p.startsWith('/api/photos/')?'image':'video').first())return fail('只能使用自己上传的图片和视频',403);}
      const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO submissions(id,user_id,payload) VALUES (?,?,?)').bind(id,user,await seal(data,env)).run();
      let queued=false;if(repoReady(env)){try{await dispatch(env,id);queued=true;}catch(e){console.error('dispatch failed',id,e.message);}}
      return json({id,status:queued?'queued':'pending',message:queued?'已送交 GitHub 自动整理，等待人工审核':'投稿已保存，GitHub 尚未送达，可稍后重试'},201);
    }
  }
  if(/^\/api\/submissions\/[0-9a-f-]{36}\/retry$/.test(path)&&method==='POST') {
    if(!user)return fail('请先登录',401);
    const id=path.split('/')[3],row=await env.DB.prepare('SELECT status FROM submissions WHERE id=? AND user_id=?').bind(id,user).first();if(!row)return fail('Not found',404);
    if(row.status!=='pending')return json({status:row.status});if(!repoReady(env))return fail('GitHub 尚未配置',503);
    await dispatch(env,id);return json({status:'queued'});
  }
  if(path.startsWith('/api/')||path.startsWith('/auth/'))return fail('Not found',404);
  if(!['GET','HEAD'].includes(method))return fail('Method not allowed',405);
  return env.ASSETS.fetch(req);
}
export default {async fetch(req,env) {
  let response;
  try { response=await routes(req,env); } catch(e){console.error(e.message);response=fail(e instanceof InputError||e instanceof GitHubAuthorizationError?e.message:'服务暂时不可用，请稍后重试',e instanceof InputError?400:e instanceof GitHubAuthorizationError?e.status:503);}
  const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','geolocation=(self), camera=()');headers.set('X-Frame-Options',new URL(req.url).pathname==='/amap-guide.html'?'SAMEORIGIN':'DENY');
  return new Response(response.body,{status:response.status,headers});
}};
