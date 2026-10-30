let cached=null;
async function publicAsset(url){
 for(let hops=0;hops<5;hops++){
  const target=new URL(url);
  if(target.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname))throw new Error('Invalid release download host');
  const r=await fetch(target,{redirect:'manual',headers:{'User-Agent':'guet-food-share',Accept:'application/octet-stream'},signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('Location'),target).toString();continue;}
  return r;
 }
 throw new Error('Too many release redirects');
}
async function latest(env){
 if(cached?.repo===env.GITHUB_REPO&&cached.expires>Date.now())return cached.value;
 if(!/^[-\w.]+\/[-\w.]+$/.test(env.GITHUB_REPO||''))return null;
 // Public latest-download links avoid GitHub's shared anonymous REST API quota.
 const r=await publicAsset(`https://github.com/${env.GITHUB_REPO}/releases/latest/download/update.json`);
 if(r.status===404)return null;if(!r.ok)throw new Error(`Cannot read Android release manifest (${r.status})`);
 const data=await r.json();
 if(!Number.isSafeInteger(data.versionCode)||data.versionCode<=0||!Number.isSafeInteger(data.size)||data.size<=0||data.size>250*1024*1024||!/^\d+\.\d+\.\d+$/.test(data.versionName)||!/^[a-f0-9]{64}$/.test(data.sha256)||data.packageName!=='com.guet.foodshare'||!/^[A-Za-z0-9._-]+\.apk$/.test(data.assetName))throw new Error('Invalid Android update manifest');
 const value={...data,assetId:data.versionCode,releaseUrl:`https://github.com/${env.GITHUB_REPO}/releases/tag/android-v${data.versionName}`};
 cached={repo:env.GITHUB_REPO,expires:Date.now()+300000,value};return value;
}
export async function appUpdate(req,env){
 const path=new URL(req.url).pathname,info=await latest(env);
 if(path==='/api/app-update')return Response.json(info?{available:true,...info,downloadPath:`/api/app-download/${info.assetId}`}:{available:false},{headers:{'Cache-Control':'public, max-age=300'}});
 if(!info||path!==`/api/app-download/${info.assetId}`)return Response.json({error:'安装包已更新，请重新检查版本'},{status:404});
 const r=await publicAsset(`https://github.com/${env.GITHUB_REPO}/releases/download/android-v${info.versionName}/${info.assetName}`);if(!r.ok)throw new Error('Cannot download Android APK');
 return new Response(r.body,{headers:{'Content-Type':'application/vnd.android.package-archive','Content-Length':String(info.size),'Content-Disposition':'attachment; filename="guet-food-share.apk"','Cache-Control':'public, max-age=300'}});
}
