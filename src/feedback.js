import {seal} from './crypto.js';
import {InputError} from './validation.js';
import {serveMedia} from './github-media.js';
import {gitHubUserToken} from './github-user.js';
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const ownerToken=env=>env.FEEDBACK_GITHUB_TOKEN;
const repos=env=>({web:env.FEEDBACK_WEB_REPO||'zxymiku/guet-food-share-web',android:env.GITHUB_REPO||'zxymiku/guet-food-share'});
const headers=accessToken=>({Authorization:`Bearer ${accessToken}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'guet-food-share','X-GitHub-Api-Version':'2022-11-28'});
const error=(message,status=400)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function feedbackConfig(env){return {webIssuesUrl:`https://github.com/${repos(env).web}/issues/new`,androidIssuesUrl:`https://github.com/${repos(env).android}/issues/new`,automaticReady:!!ownerToken(env)||!!env.GITHUB_CLIENT_ID,sharedPasswordReady:!!ownerToken(env),screenshotsReady:!!(env.MEDIA_GITHUB_TOKEN||env.GITHUB_TOKEN)&&!!env.MEDIA_REPO};}
function normalized(input){
 if(!input||!validId(input.requestId)||!['web','android'].includes(input.platform))throw new InputError('反馈平台或请求编号无效');
 if(input.consent!==true)throw new InputError('请确认同意公开反馈文字和截图');
 const title=typeof input.title==='string'?input.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
 const description=typeof input.description==='string'?input.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim():'';
 if(!title||title.length>100||!description||description.length>4000)throw new InputError('请填写反馈标题（100 字以内）和详情（4000 字以内）');
 const screenshots=input.screenshots??[];
 if(!Array.isArray(screenshots)||screenshots.length>3||screenshots.some(p=>typeof p!=='string'||!/^\/api\/photos\/[0-9a-f-]{36}$/.test(p)))throw new InputError('最多添加 3 张本站上传的截图');
 const appVersion=typeof input.appVersion==='string'?input.appVersion.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,50):'';
 return {requestId:input.requestId,platform:input.platform,title,description,screenshots:[...new Set(screenshots)],appVersion,consent:true};
}
function validIssue(issue,repo){return Number.isSafeInteger(issue?.number)&&issue.number>0&&issue.html_url===`https://github.com/${repo}/issues/${issue.number}`;}
async function posted(env,id,issue){
 await env.DB.prepare("UPDATE feedback SET status='posted',issue_url=?,issue_number=? WHERE id=?").bind(issue.html_url,issue.number,id).run();
 return Response.json({id,issueUrl:issue.html_url,number:issue.number},{status:201,headers:{'Cache-Control':'no-store'}});
}
export async function submitFeedback(req,env,user,input){
 if(!user)return error('请先使用共享密码或 GitHub 登录后自动反馈',401);
 const data=normalized(input),repo=repos(env)[data.platform];
 if(!/^[-\w.]+\/[-\w.]+$/.test(repo))return error('反馈仓库未配置',503);
 const shared=user.startsWith('credential:');
 if(shared&&!ownerToken(env))return error('请管理员配置仅授权对应仓库 Issues 写权限的 FEEDBACK_GITHUB_TOKEN，用管理员账号代发密码用户反馈',503);
 let actorToken;
 const actor=async()=>actorToken??=(shared?ownerToken(env):await gitHubUserToken(env,user,data.platform));
 const hash=await digest(JSON.stringify(data));
 const existing=await env.DB.prepare('SELECT * FROM feedback WHERE id=?').bind(data.requestId).first();
 if(existing){
  if(existing.user_id!==user||existing.request_hash!==hash)return error('反馈编号已使用，请重新打开反馈表单',409);
  if(existing.status==='posted')return Response.json({id:existing.id,issueUrl:existing.issue_url,number:existing.issue_number});
  if(existing.status==='sending'){
   if(Date.now()-Date.parse(existing.created_at)<30000)return error('反馈正在提交，请稍后用同一表单重试确认结果',409);
   const response=await fetch(`https://api.github.com/repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=100`,{headers:headers(await actor()),signal:AbortSignal.timeout(15000)});
   if(response.ok){const issues=await response.json();const found=issues.find(i=>!i.pull_request&&i.body?.includes(`<!-- guet-feedback:${data.requestId} -->`)&&validIssue(i,repo));if(found)return posted(env,data.requestId,found);}
   return error(`反馈结果仍在确认，请勿重复提交新反馈。编号：${data.requestId}`,409);
  }
 }
 const count=await env.DB.prepare("SELECT count(*) AS n FROM feedback WHERE user_id=? AND status!='failed' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')").bind(user).first();
 if(count.n>=5)return error('今日自动反馈已达 5 次，请稍后再试',429);
 for(const path of data.screenshots){if(!await env.DB.prepare("SELECT 1 FROM media WHERE id=? AND user_id=? AND kind='image'").bind(path.split('/').at(-1),user).first())return error('只能附加自己上传的图片截图',403);}
 await actor();
 const payload=await seal(data,env,'feedback');
 const claimed=existing
  ?await env.DB.prepare("UPDATE feedback SET status='sending' WHERE id=? AND status='failed' RETURNING id").bind(data.requestId).first()
  :await env.DB.prepare("INSERT INTO feedback(id,user_id,platform,request_hash,payload,status) VALUES (?,?,?,?,?,'sending') ON CONFLICT(id) DO NOTHING RETURNING id").bind(data.requestId,user,data.platform,hash,payload).first();
 if(!claimed)return error('反馈正在提交，请稍后确认',409);
 const origin=env.APP_ORIGIN||new URL(req.url).origin,attachments=[];
 // Unguessable links permit GitHub's image proxy to fetch only the explicitly attached screenshots.
 // They are enabled while posting, revoked after a definite failure, and do not publish normal photo URLs.
 for(const path of data.screenshots){
  const id=path.split('/').at(-1),key=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT INTO feedback_screenshots(feedback_id,media_id,access_hash) VALUES (?,?,?) ON CONFLICT(feedback_id,media_id) DO UPDATE SET access_hash=excluded.access_hash').bind(data.requestId,id,await digest(key)).run();
  attachments.push(`![反馈截图 ${attachments.length+1}](${origin}/api/feedback/${data.requestId}/screenshots/${id}?key=${key})`);
 }
 const runs=data.description.match(/`+/g)||[],fence='`'.repeat(Math.max(3,...runs.map(s=>s.length+1)));
 const body=`平台：${data.platform==='web'?'Web':'Android'}\n应用版本：${data.appVersion||'未提供'}\n\n${fence}text\n${data.description}\n${fence}\n\n${attachments.join('\n\n')}\n\n<!-- guet-feedback:${data.requestId} -->`;
 let response;
 try{response=await fetch(`https://api.github.com/repos/${repo}/issues`,{method:'POST',headers:headers(await actor()),body:JSON.stringify({title:`[${data.platform==='web'?'Web':'Android'}反馈] ${data.title.replaceAll('@','＠')}`,body}),signal:AbortSignal.timeout(20000)});}
 catch{return error(`提交结果未确认，请保留当前表单稍后重试。编号：${data.requestId}`,409);}
 if(!response.ok){
  if(response.status<500)await env.DB.prepare("UPDATE feedback SET status='failed' WHERE id=?").bind(data.requestId).run();
  return error([401,403,404].includes(response.status)?(shared?'GitHub 拒绝创建 Issue，请管理员检查对应仓库的 Issues 写权限':'GitHub 授权不可用，请重新登录并授权 GitHub App 在对应仓库创建 Issue'):'GitHub 暂时无法处理反馈，请保留表单稍后重试',503);
 }
 let issue;try{issue=await response.json();}catch{return error('反馈结果未确认，请稍后用同一表单重试',409);}
 if(!validIssue(issue,repo))return error('反馈结果未确认，请稍后用同一表单重试',409);
 return posted(env,data.requestId,issue);
}
export async function feedbackScreenshot(req,env,feedbackId,mediaId){
 const key=new URL(req.url).searchParams.get('key');
 if(!key||!/^[a-f0-9]{64}$/.test(key))return error('Not found',404);
 const row=await env.DB.prepare("SELECT media.* FROM feedback_screenshots f JOIN feedback ON feedback.id=f.feedback_id JOIN media ON media.id=f.media_id WHERE f.feedback_id=? AND f.media_id=? AND f.access_hash=? AND feedback.status IN ('sending','posted') AND media.kind='image'").bind(feedbackId,mediaId,await digest(key)).first();
 return row?serveMedia(req,env,row):error('Not found',404);
}
