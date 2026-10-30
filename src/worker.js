import {normalize, InputError} from './validation.js';
import {seal,unseal} from './crypto.js';
import {uploadMedia,serveMedia} from './github-media.js';
import {appUpdate} from './app-update.js';

const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...headers}});
const fail = (message, status = 400) => json({error: message}, status);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const local = req => ['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname);
const dev = (req, env) => env.DEV_MODE === 'true' && local(req);
const cookie = (req, key) => (req.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1);
const cookieHeader = (req, name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
async function token(user,env){return seal({user,exp:Date.now()+7*86400000},env,'session');}
async function session(req,env){
 const raw=req.headers.get('Authorization')?.replace(/^Bearer /,'')||cookie(req,'session');
 if(!raw||!raw.startsWith('enc1.'))return null;
 try{const value=await unseal(raw,env,'session');return value.exp>Date.now()?value.user:null;}catch{return null;}
}
async function body(req, max = 20000) {
  if (Number(req.headers.get('Content-Length')) > max) throw new InputError('请求内容过大');
  const reader = req.body?.getReader(); if (!reader) throw new InputError('请求为空');
  const chunks=[]; let total=0;
  while (true) {const {done,value}=await reader.read(); if(done) break; total+=value.length; if(total>max){await reader.cancel();throw new InputError('请求内容过大');} chunks.push(value);}
  const all=new Uint8Array(total); let offset=0; for(const c of chunks){all.set(c,offset);offset+=c.length;} return all;
}
async function readJson(req) { try {return JSON.parse(new TextDecoder().decode(await body(req)));} catch(e) {throw new InputError(e instanceof InputError ? e.message : 'JSON 格式错误');} }
async function github(env, path, payload) {
  const response = await fetch(`https://api.github.com${path}`, {method:'POST', headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json','User-Agent':'guet-food-share','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(payload)});
  if(!response.ok) throw new Error(`GitHub ${response.status}`);
}
function repoReady(env){return /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || '') && !!env.GITHUB_TOKEN;}
const reviewer = (user,env) => !!user && (env.REVIEWER_GITHUB_IDS||'').split(',').map(x=>x.trim()).includes(user);
async function dispatch(env,id){await github(env,`/repos/${env.GITHUB_REPO}/dispatches`,{event_type:'food-submitted',client_payload:{id}});await env.DB.prepare("UPDATE submissions SET status='queued' WHERE id=? AND status='pending'").bind(id).run();}
async function routes(req, env) {
  const url = new URL(req.url), path = url.pathname, method = req.method;
  if (env.APP_ORIGIN && !dev(req, env) && url.origin !== env.APP_ORIGIN) return fail('访问域名未配置',403);
  if (!['GET','HEAD'].includes(method) && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin) return fail('来源不受信任',403);
  if (path === '/api/config') return json({amapKey:env.AMAP_WEB_KEY || '',dev:dev(req,env),githubReady:repoReady(env),loginReady:!!env.GITHUB_CLIENT_ID});
  if((path==='/api/app-update'||/^\/api\/app-download\/\d+$/.test(path))&&method==='GET')return appUpdate(req,env);
  if(path==='/api/location'&&method==='POST'){
    if(!await session(req,env))return fail('请先登录后自动填写位置',401);
    const {lng,lat}=await readJson(req);
    if(typeof lng!=='number'||typeof lat!=='number'||!Number.isFinite(lng)||!Number.isFinite(lat)||lng<73||lng>136||lat<3||lat>54)return fail('坐标无效');
    if(!env.AMAP_REST_KEY)return fail('请配置高德 Web 服务 Key 后使用地址自动填写',503);
    const target=new URL('https://restapi.amap.com/v3/geocode/regeo');target.search=new URLSearchParams({key:env.AMAP_REST_KEY,location:`${lng},${lat}`,extensions:'all',radius:'100',poitype:'050000|060000'}).toString();
    const r=await fetch(target,{signal:AbortSignal.timeout(10000)}),data=await r.json();if(data.status!=='1')return fail('地址解析失败，请手动填写',502);
    return json({address:data.regeocode.formatted_address,pois:(data.regeocode.pois||[]).slice(0,8).map(p=>({name:p.name,distance:Number(p.distance),address:p.address,location:p.location}))});
  }
  if (path.startsWith('/_AMapService/')) {
    const sub = path.slice('/_AMapService'.length);
    if(method !== 'GET' || !/^\/v[345]\/[a-zA-Z0-9/_-]+$/.test(sub) || !env.AMAP_SECURITY_JS_CODE) return fail('地图服务未配置',503);
    const target = new URL('https://restapi.amap.com'+sub); target.search=url.search; target.searchParams.set('jscode',env.AMAP_SECURITY_JS_CODE);
    const r=await fetch(target,{signal:AbortSignal.timeout(10000)}); return new Response(r.body,{status:r.status,headers:{'Content-Type':r.headers.get('Content-Type')||'application/json','Cache-Control':'no-store'}});
  }
  if(path === '/auth/github' && method==='GET') {
    if(!env.GITHUB_CLIENT_ID) return fail('请先配置 GitHub OAuth App',503);
    const challenge=url.searchParams.get('challenge');
    if(challenge && !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('无效登录参数');
    const state=crypto.randomUUID();
    await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO oauth_states VALUES (?,?,?)').bind(state,Date.now()+600000,challenge).run();
    const target=new URL('https://github.com/login/oauth/authorize'); target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',scope:'read:user',state}).toString();
    return new Response(null,{status:302,headers:{Location:target.toString(),'Set-Cookie':cookieHeader(req,'oauth_state',state,600)}});
  }
  if(path === '/auth/callback') {
    const state=url.searchParams.get('state');
    if(!state || cookie(req,'oauth_state')!==state) return fail('登录校验失败，请重新登录',403);
    const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING *').bind(state,Date.now()).first();
    if(!row || !url.searchParams.get('code')) return fail('登录已过期或取消',403);
    const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:url.origin+'/auth/callback'})});
    const access=await exchange.json(); if(!access.access_token) return fail('GitHub 登录失败',502);
    const profile=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${access.access_token}`,'User-Agent':'guet-food-share'}}); if(!profile.ok) return fail('无法获取登录信息',502);
    const p=await profile.json(), user=String(p.id);
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
  if(path === '/api/me') {const user=await session(req,env);return json({user,reviewer:reviewer(user,env)});}
  if(/^\/api\/review\/[0-9a-f-]{36}$/.test(path) && method==='GET') {
    if(!reviewer(await session(req,env),env))return fail('请以配置的审核员 GitHub 账号登录',403);
    const row=await env.DB.prepare('SELECT id,payload,status FROM submissions WHERE id=?').bind(path.split('/').at(-1)).first();
    return row?json({id:row.id,status:row.status,...await unseal(row.payload,env)}):fail('Not found',404);
  }
  if(path === '/api/places' && method==='GET') {
    const rows=await env.DB.prepare('SELECT id,payload FROM places ORDER BY published_at DESC LIMIT 500').all();
    return json({places:rows.results.map(r=>({ ...JSON.parse(r.payload),id:r.id}))});
  }
  if(path.startsWith('/api/internal/')) {
    if(!env.PIPELINE_SECRET || req.headers.get('Authorization')!==`Bearer ${env.PIPELINE_SECRET}`) return fail('Unauthorized',401);
    const id=path.split('/').at(-1); if(!/^[0-9a-f-]{36}$/.test(id)) return fail('ID 无效');
    if(path.startsWith('/api/internal/submissions/') && method==='GET') {
      const row=await env.DB.prepare('SELECT id,payload FROM submissions WHERE id=?').bind(id).first();
      return row ? json({id:row.id,...await unseal(row.payload,env)}) : fail('Not found',404);
    }
    if(path.startsWith('/api/internal/publish/') && method==='POST') {
      const raw=await readJson(req), data=normalize(raw);
      const row=await env.DB.prepare('SELECT payload FROM submissions WHERE id=?').bind(id).first();
      if(!row) return fail('投稿不存在',404);
      if(JSON.stringify(normalize(await unseal(row.payload,env)))!==JSON.stringify(data)) return fail('审核数据与原投稿不一致，请重新投稿后审核',409);
      await env.DB.batch([env.DB.prepare('INSERT INTO places(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').bind(id,JSON.stringify(data)),env.DB.prepare("UPDATE submissions SET status='published' WHERE id=?").bind(id)]);
      return json({ok:true});
    }
    return fail('Not found',404);
  }
  if((path.startsWith('/api/photos/')||path.startsWith('/api/media/'))&&method==='GET') {
    const id=path.split('/').at(-1);if(!/^[0-9a-f-]{36}$/.test(id))return fail('Not found',404);
    const row=await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first();if(!row)return fail('Not found',404);
    const user=await session(req,env);
    const visible=await env.DB.prepare("SELECT 1 FROM places,json_each(places.payload,?) WHERE json_each.value=? LIMIT 1").bind(row.kind==='video'?'$.videos':'$.photos',path).first();
    if(!visible&&row.user_id!==user&&!reviewer(user,env))return fail('Not found',404);
    return serveMedia(req,env,row);
  }
  if((path==='/api/photos'||path==='/api/media')&&method==='POST'){
    const user=await session(req,env);if(!user)return fail('请先登录',401);
    return json(await uploadMedia(req,env,user),201);
  }
  if(path === '/api/submissions') {
    const user=await session(req,env); if(!user) return fail('请先登录',401);
    if(method==='GET') {const rows=await env.DB.prepare('SELECT id,status,created_at,payload FROM submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user).all();return json({submissions:await Promise.all(rows.results.map(async r=>({id:r.id,status:r.status,createdAt:r.created_at,name:(await unseal(r.payload,env)).name})))});}
    if(method==='POST') {
      const data=normalize(await readJson(req));
      const count=await env.DB.prepare("SELECT count(*) AS n FROM submissions WHERE user_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')").bind(user).first();if(count.n>=10) return fail('今日投稿次数已达上限',429);
      for(const p of [...data.photos,...data.videos]){if(!await env.DB.prepare('SELECT 1 FROM media WHERE id=? AND user_id=? AND kind=?').bind(p.split('/').at(-1),user,p.startsWith('/api/photos/')?'image':'video').first())return fail('只能使用自己上传的图片和视频',403);}
      const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO submissions(id,user_id,payload) VALUES (?,?,?)').bind(id,user,await seal(data,env)).run();
      let queued=false;if(repoReady(env)){try{await dispatch(env,id);queued=true;}catch(e){console.error('dispatch failed',id,e.message);}}
      return json({id,status:queued?'queued':'pending',message:queued?'已送交 GitHub 自动整理，等待人工审核':'投稿已保存，GitHub 尚未送达，可稍后重试'},201);
    }
  }
  if(/^\/api\/submissions\/[0-9a-f-]{36}\/retry$/.test(path)&&method==='POST') {
    const user=await session(req,env);if(!user)return fail('请先登录',401);
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
  try { response=await routes(req,env); } catch(e){console.error(e.message);response=fail(e instanceof InputError?e.message:'服务暂时不可用，请稍后重试',e instanceof InputError?400:503);}
  const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','geolocation=(self), camera=()');headers.set('X-Frame-Options','DENY');
  return new Response(response.body,{status:response.status,headers});
}};
