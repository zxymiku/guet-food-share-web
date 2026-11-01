import {InputError} from './validation.js';
async function hash(env,text){
 if(!env.DATA_ENCRYPTION_KEY)throw new Error('Missing encryption key');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.DATA_ENCRYPTION_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('reviews:'+text))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function reviews(req,env,id,user,input){
 if(!await env.DB.prepare('SELECT id FROM places WHERE id=?').bind(id).first())return Response.json({error:'地点不存在'},{status:404});
 if(req.method==='GET'){
 const summary=await env.DB.prepare('SELECT count(*) AS count,avg(score) AS average FROM reviews WHERE place_id=?').bind(id).first();
 const before=new URL(req.url).searchParams.get('before')||'9999';
 const rows=await env.DB.prepare('SELECT id,score,comment,created_at FROM reviews WHERE place_id=? AND id<? ORDER BY id DESC LIMIT 100').bind(id,before).all();
 return Response.json({...summary,reviews:rows.results,nextCursor:rows.results.length===100?rows.results.at(-1).id:null},{headers:{'Cache-Control':'no-store'}});
 }
 if(!user)return Response.json({error:'请先登录'},{status:401});
 if(!Number.isInteger(input.score)||input.score<1||input.score>5||typeof input.comment!=='string'||input.comment.length>1000||!/^[-a-zA-Z0-9]{20,80}$/.test(input.deviceId||''))throw new InputError('请选择 1～5 分，评价最多 1000 字，并允许设备标识');
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const ip=await hash(env,'ip:'+day+':'+(req.headers.get('CF-Connecting-IP')||'unknown'));
 const device=await hash(env,'device:'+day+':'+input.deviceId);
 try{await env.DB.prepare('INSERT INTO reviews(id,place_id,score,comment,day,ip_hash,device_hash) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,input.score,input.comment.normalize('NFKC').replace(/[\u0000-\u001f]/g,' '),day,ip,device).run();}
 catch(e){if(/UNIQUE constraint/i.test(e.message))return Response.json({error:'同一 IP 或设备每天对该地点只能评价一次（北京时间）'},{status:429});throw e;}
 return Response.json({ok:true},{status:201});
}
