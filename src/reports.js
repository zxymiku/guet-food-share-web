import {InputError} from './validation.js';
export const reportReasons=['信息有误','已停业','重复地点','不当内容','隐私侵权','其他'];
export async function submitReport(env,user,input){
 if(!user)return Response.json({error:'请先登录后提交纠错或举报'},{status:401});
 if(!input||!['place','review'].includes(input.type)||!/^[-0-9a-f]{36}$/.test(input.targetId||'')||!reportReasons.includes(input.reason)||typeof input.detail!=='string'||input.detail.length>1000)throw new InputError('请选择有效目标和原因，详情最多 1000 字');
 const table=input.type==='place'?'places':'reviews';
 if(!await env.DB.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(input.targetId).first())return Response.json({error:'目标不存在'},{status:404});
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),id=crypto.randomUUID();
 // One atomic statement applies both the duplicate and daily quotas.
 try{const r=await env.DB.prepare('INSERT INTO reports(id,user_id,target_type,target_id,reason,detail,day) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM reports WHERE user_id=? AND day=?)<20').bind(id,user,input.type,input.targetId,input.reason,input.detail.trim(),day,user,day).run();if(!r.meta.changes)return Response.json({error:'今日纠错举报已达 20 次'},{status:429});}
 catch(e){if(/UNIQUE constraint/.test(e.message))return Response.json({error:'今天已反馈该内容，请勿重复提交'},{status:429});throw e;}
 return Response.json({id,message:'已保存到审核队列，处理前不会自动改动公开信息'},{status:201});
}
export async function moderate(env,input,actor){
 if(!input||!['resolve','hide','restore'].includes(input.action)||!/^[-0-9a-f]{36}$/.test(input.id||''))throw new InputError('审核操作无效');
 const r=await env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(input.id).first();if(!r)return Response.json({error:'反馈不存在'},{status:404});
 const statements=[];
 if(r.target_type==='place'&&input.action==='hide')statements.push(env.DB.prepare('INSERT INTO hidden_places(place_id,reason) VALUES (?,?) ON CONFLICT(place_id) DO UPDATE SET reason=excluded.reason').bind(r.target_id,r.reason));
 if(r.target_type==='place'&&input.action==='restore')statements.push(env.DB.prepare('DELETE FROM hidden_places WHERE place_id=?').bind(r.target_id));
 if(r.target_type==='review'&&input.action==='hide')statements.push(env.DB.prepare('UPDATE reviews SET removed_at=CURRENT_TIMESTAMP WHERE id=?').bind(r.target_id));
 if(r.target_type==='review'&&input.action==='restore')throw new InputError('已撤回评价不可自动恢复，请联系作者重新处理');
 statements.push(env.DB.prepare("UPDATE reports SET status='resolved' WHERE id=?").bind(r.id));statements.push(env.DB.prepare('INSERT INTO moderation_events(id,report_id,action,actor_id) VALUES (?,?,?,?)').bind(crypto.randomUUID(),r.id,input.action,actor));await env.DB.batch(statements);return Response.json({ok:true});
}
