import {seal,unseal} from './crypto.js';
export class GitHubAuthorizationError extends Error {constructor(message,status=401){super(message);this.status=status;}}
const repoId=(env,platform)=>platform==='web'?env.GITHUB_WEB_REPO_ID:env.GITHUB_ANDROID_REPO_ID;
export async function saveGitHubGrant(env,user,access,platform){
 if(typeof access.access_token!=='string'||!access.access_token.startsWith('ghu_'))throw new GitHubAuthorizationError('请管理员配置仅授权对应仓库 Issues 权限的 GitHub App；不使用宽泛的 OAuth 仓库权限',503);
 if(!['web','android'].includes(platform)||!/^\d+$/.test(repoId(env,platform)||''))throw new GitHubAuthorizationError('请配置对应平台 GitHub 仓库数字 ID',503);
 const grant={accessToken:access.access_token,refreshToken:access.refresh_token||null,expiresAt:access.expires_in?Date.now()+Number(access.expires_in)*1000:null,refreshExpiresAt:access.refresh_token_expires_in?Date.now()+Number(access.refresh_token_expires_in)*1000:null,clientId:env.GITHUB_CLIENT_ID,repositoryId:repoId(env,platform)};
 const payload=await seal(grant,env,'github-user-grant');
 await env.DB.prepare('INSERT INTO github_user_grants(user_id,platform,payload,refresh_lock_until) VALUES (?,?,?,0) ON CONFLICT(user_id,platform) DO UPDATE SET payload=excluded.payload,refresh_lock_until=0').bind(user,platform,payload).run();
}
export async function gitHubUserToken(env,user,platform){
 const row=await env.DB.prepare('SELECT * FROM github_user_grants WHERE user_id=? AND platform=?').bind(user,platform).first();
 if(!row)throw new GitHubAuthorizationError('请重新使用 GitHub 登录并授权本项目，以你自己的账号发布反馈');
 const grant=await unseal(row.payload,env,'github-user-grant');
 if(grant.clientId!==env.GITHUB_CLIENT_ID||grant.repositoryId!==repoId(env,platform))throw new GitHubAuthorizationError('GitHub App 或仓库配置已更新，请重新登录');
 if(!grant.expiresAt||grant.expiresAt>Date.now()+60000)return grant.accessToken;
 if(!grant.refreshToken||grant.refreshExpiresAt&&grant.refreshExpiresAt<=Date.now())throw new GitHubAuthorizationError('GitHub 授权已过期，请重新登录');
 const lock=Date.now()+30000;
 const claimed=await env.DB.prepare('UPDATE github_user_grants SET refresh_lock_until=? WHERE user_id=? AND platform=? AND payload=? AND refresh_lock_until<? RETURNING user_id').bind(lock,user,platform,row.payload,Date.now()).first();
 if(!claimed)throw new GitHubAuthorizationError('GitHub 授权正在更新，请稍后重试',409);
 try{
  const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:grant.refreshToken}),signal:AbortSignal.timeout(15000)});
  const access=await r.json();if(!r.ok||!access.access_token)throw new GitHubAuthorizationError('GitHub 授权已失效，请重新登录');
  await saveGitHubGrant(env,user,access,platform);return access.access_token;
 }finally{await env.DB.prepare('UPDATE github_user_grants SET refresh_lock_until=0 WHERE user_id=? AND platform=? AND refresh_lock_until=?').bind(user,platform,lock).run();}
}
