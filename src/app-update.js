import {assetResponse} from './github-media.js';
let cached=null;
async function latest(env){
 if(cached?.repo===env.GITHUB_REPO&&cached.expires>Date.now())return cached.value;
 const r=await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`,{headers:{...(env.GITHUB_TOKEN?{Authorization:`Bearer ${env.GITHUB_TOKEN}`} : {}),Accept:'application/vnd.github+json','User-Agent':'guet-food-share'}});
 if(r.status===404)return null;if(!r.ok)throw new Error('Cannot read latest Android release');
 const release=await r.json(),manifest=release.assets.find(a=>a.name==='update.json');if(!manifest)return null;
 const mr=await assetResponse(env,env.GITHUB_REPO,manifest.id);if(!mr.ok)throw new Error('Cannot read update manifest');
 const data=await mr.json(),apk=release.assets.find(a=>a.name===data.assetName&&a.name.endsWith('.apk'));
 if(!apk||!Number.isSafeInteger(data.versionCode)||!Number.isSafeInteger(data.size)||data.size!==apk.size||!/^[a-f0-9]{64}$/.test(data.sha256)||data.packageName!=='com.guet.foodshare')throw new Error('Invalid Android update manifest');
 const value={...data,assetId:apk.id,releaseUrl:release.html_url};
 cached={repo:env.GITHUB_REPO,expires:Date.now()+300000,value};
 return value;
}
export async function appUpdate(req,env){
 const path=new URL(req.url).pathname;
 const info=await latest(env);
 if(path==='/api/app-update')return Response.json(info?{available:true,...info,downloadPath:`/api/app-download/${info.assetId}`}:{available:false},{headers:{'Cache-Control':'public, max-age=300'}});
 if(!info||path!==`/api/app-download/${info.assetId}`)return Response.json({error:'安装包已更新，请重新检查版本'},{status:404});
 const r=await assetResponse(env,env.GITHUB_REPO,info.assetId);if(!r.ok)throw new Error('Cannot download Android APK');
 return new Response(r.body,{headers:{'Content-Type':'application/vnd.android.package-archive','Content-Length':String(info.size),'Content-Disposition':'attachment; filename="guet-food-share.apk"','Cache-Control':'public, max-age=300'}});
}
