import {decodeCursor,encodeCursor} from './pagination.js';
import {InputError} from './validation.js';
async function hash(env,text){
 if(!env.DATA_ENCRYPTION_KEY)throw new Error('Missing encryption key');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.DATA_ENCRYPTION_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('reviews:'+text))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function reviews(req,env,id,user,input){
 if(!await env.DB.prepare('SELECT id FROM places WHERE id=? AND NOT EXISTS(SELECT 1 FROM hidden_places WHERE place_id=places.id)').bind(id).first())return Response.json({error:'地点不存在'},{status:404});
 if(req.method==='GET'){
 const summary=await env.DB.prepare('SELECT count(*) AS count,avg(score) AS average FROM reviews WHERE place_id=? AND removed_at IS NULL').bind(id).first();
 const value=new URL(req.url).searchParams.get('before');
 const legacy=value&&/^[0-9a-f-]{36}$/.test(value),cursor=legacy?null:decodeCursor(value);
 const condition=legacy?'AND id<?':cursor?'AND (created_at<? OR (created_at=? AND id<?))':'';
 const rows=await env.DB.prepare(`SELECT id,score,comment,created_at,user_id FROM reviews WHERE place_id=? AND removed_at IS NULL ${condition} ORDER BY created_at DESC,id DESC LIMIT 101`).bind(id,...(legacy?[value]:cursor?[cursor[0],cursor[0],cursor[1]]:[])).all();
 const page=rows.results.slice(0,100);
 return Response.json({...summary,reviews:page.map(({user_id,...r})=>({...r,canDelete:!!user&&user_id===user})),nextCursor:rows.results.length>100?encodeCursor(page.at(-1)):null},{headers:{'Cache-Control':'no-store'}});
 }
 if(!user)return Response.json({error:'请先登录'},{status:401});
 if(!Number.isInteger(input?.score)||input.score<1||input.score>5||typeof input.comment!=='string'||input.comment.length>1000||!/^[-a-zA-Z0-9]{20,80}$/.test(input.deviceId||''))throw new InputError('请选择 1～5 分，评价最多 1000 字，并允许设备标识');
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const ip=await hash(env,'ip:'+day+':'+(req.headers.get('CF-Connecting-IP')||'unknown'));
 const device=await hash(env,'device:'+day+':'+input.deviceId);
 try{const result=await env.DB.prepare('INSERT INTO reviews(id,place_id,score,comment,day,ip_hash,device_hash,user_id) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM places WHERE id=?) AND NOT EXISTS(SELECT 1 FROM hidden_places WHERE place_id=?)').bind(crypto.randomUUID(),id,input.score,input.comment.normalize('NFKC').replace(/[\u0000-\u001f]/g,' '),day,ip,device,user,id,id).run();if(!result.meta.changes)return Response.json({error:'地点已撤回'},{status:404});}
 catch(e){if(/UNIQUE constraint/i.test(e.message))return Response.json({error:'同一账号、IP 或设备每天对该地点只能评价一次（北京时间）'},{status:429});throw e;}
 return Response.json({ok:true},{status:201});
}

export async function removeReview(env,id,user){
 if(!user)return Response.json({error:'请先登录'},{status:401});
 const result=await env.DB.prepare("UPDATE reviews SET removed_at=COALESCE(removed_at,CURRENT_TIMESTAMP),comment='' WHERE id=? AND user_id=?").bind(id,user).run();
 return result.meta.changes?Response.json({ok:true}):Response.json({error:'只能撤回本人评价，历史无身份评价请举报处理'},{status:403});
}
