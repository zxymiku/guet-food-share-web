import {seal,unseal} from './crypto.js';
const enc=new TextEncoder();
const descriptorPattern=/^pbkdf2-sha256\$100000\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=text=>Uint8Array.from(text.match(/../g),b=>parseInt(b,16));
const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const cookie=(req,name)=>(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const failure=(message,status=400,extra={})=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store',...extra}});
export const passwordReady=env=>descriptorPattern.test(env.PASSWORD_CREDENTIAL||'');
async function credentialVersion(env){return hex(await crypto.subtle.digest('SHA-256',enc.encode(env.PASSWORD_CREDENTIAL)));}
export async function identity(req,env){
 const value=req.headers.get('Authorization')?.replace(/^Bearer /,'')||cookie(req,'session');
 if(!value?.startsWith('enc1.'))return null;
 try{
  const auth=await unseal(value,env,'session');
  if(typeof auth.user!=='string'||!Number.isFinite(auth.exp)||auth.exp<=Date.now())return null;
  if(auth.kind==='credential'||auth.user.startsWith('credential:')){
   if(auth.kind!=='credential'||auth.role!=='contributor'||!uuid(auth.user.slice(11))||!passwordReady(env)||auth.credentialVersion!==await credentialVersion(env))return null;
   return {user:auth.user,kind:'credential',role:'contributor'};
  }
  return {user:auth.user,kind:auth.kind||'github',role:'user'};
 }catch{return null;}
}
export function credentialAllowed(method,path){
 if(method==='GET')return ['/api/config','/api/me','/api/places','/api/submissions','/api/app-update'].includes(path)||/^\/api\/(?:photos|media)\/[0-9a-f-]{36}$/.test(path)||/^\/api\/app-download\/\d+$/.test(path)||/^\/api\/feedback\/[0-9a-f-]{36}\/screenshots\/[0-9a-f-]{36}$/.test(path);
 if(method==='POST')return ['/api/auth/password','/api/mobile/token','/api/logout','/api/location','/api/photos','/api/media','/api/submissions','/api/feedback','/api/feedback/screenshots'].includes(path)||/^\/api\/submissions\/[0-9a-f-]{36}\/retry$/.test(path);
 return false;
}
async function throttleKey(req,env,window){
 const secret=env.DATA_ENCRYPTION_KEY;if(!secret||secret.length<32)throw new Error('DATA_ENCRYPTION_KEY missing');
 const root=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('guet-password-throttle'),info:enc.encode('v1')},root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 // The trusted Cloudflare edge supplies CF-Connecting-IP; raw addresses are never stored.
 return hex(await crypto.subtle.sign('HMAC',key,enc.encode(`${req.headers.get('CF-Connecting-IP')||'unknown'}:${window}`)));
}
export async function passwordLogin(req,env,input){
 if(!passwordReady(env))return failure('密码凭证登录尚未启用，请联系管理员设置共享密码',503);
 if(typeof input?.password!=='string'||input.password.length<12||input.password.length>128)return failure('请输入 12～128 字符的共享密码');
 if(input.client!==undefined&&!['web','android'].includes(input.client))return failure('登录客户端无效');
 const now=Date.now(),window=Math.floor(now/900000),expires=(window+1)*900000,key=await throttleKey(req,env,window);
 await env.DB.prepare('DELETE FROM password_login_attempts WHERE expires_at<?').bind(now).run();
 const attempts=await env.DB.prepare('INSERT INTO password_login_attempts(bucket_key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,expires).first();
 if(attempts.attempts>20)return failure('密码尝试过于频繁，请稍后再试',429,{'Retry-After':String(Math.ceil((expires-now)/1000))});
 const [,salt,expected]=descriptorPattern.exec(env.PASSWORD_CREDENTIAL);
 const material=await crypto.subtle.importKey('raw',enc.encode(input.password),'PBKDF2',false,['deriveBits']);
 const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:fromHex(salt)},material,256));
 const compare=fromHex(expected);let difference=0;for(let i=0;i<compare.length;i++)difference|=actual[i]^compare[i];
 if(difference!==0)return failure('密码不正确',401);
 await env.DB.prepare('DELETE FROM password_login_attempts WHERE bucket_key=?').bind(key).run();
 let deviceId=crypto.randomUUID();
 const existing=input.client==='android'?input.deviceToken:cookie(req,'credential_device');
 if(typeof existing==='string'&&existing.length<2000){try{const device=await unseal(existing,env,'credential-device');if(uuid(device.id)&&device.exp>now)deviceId=device.id;}catch{}}
 const deviceToken=await seal({id:deviceId,exp:now+365*86400000},env,'credential-device');
 const user='credential:'+deviceId;
 const sessionToken=await seal({user,kind:'credential',role:'contributor',credentialVersion:await credentialVersion(env),exp:now+7*86400000},env,'session');
 const headers=new Headers({'Cache-Control':'no-store'});
 const flags=`; HttpOnly; SameSite=Lax; Path=/${new URL(req.url).protocol==='https:'?'; Secure':''}`;
 headers.append('Set-Cookie',`session=${sessionToken}; Max-Age=604800${flags}`);
 headers.append('Set-Cookie',`credential_device=${deviceToken}; Max-Age=31536000${flags}`);
 return Response.json({user,authType:'credential',role:'contributor',permissions:['food:read','food:submit','media:upload','feedback:submit'],...(input.client==='android'?{token:sessionToken,deviceToken}:{})},{headers});
}
