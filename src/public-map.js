// Developer-owned viewing credentials are separate from every visitor's local keys.
const valid=value=>typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value);
export function publicMapConfig(env){
 const enabled=env.AMAP_PUBLIC_MAP_ENABLED==='true';
 const webReady=enabled&&valid(env.AMAP_PUBLIC_WEB_KEY)&&valid(env.AMAP_PUBLIC_SECURITY_JS_CODE);
 const androidReady=enabled&&valid(env.AMAP_PUBLIC_ANDROID_KEY);
 return {webReady,androidReady,webKey:webReady?env.AMAP_PUBLIC_WEB_KEY:null,androidKey:androidReady?env.AMAP_PUBLIC_ANDROID_KEY:null,serviceHost:'/_AMapService',purpose:'browse'};
}
const response=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const cap=(value,fallback,max)=>/^\d+$/.test(value||'')?Math.max(1,Math.min(max,Number(value))):fallback;
async function allowance(req,env){
 const now=new Date(Date.now()+8*3600000).toISOString(),day=now.slice(0,10);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AMAP_PUBLIC_SECURITY_JS_CODE),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hash=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(day+'\0'+(req.headers.get('CF-Connecting-IP')||'unknown')))).slice(0,16),n=>n.toString(16).padStart(2,'0')).join('');
 const global='day:'+day,client='ip:'+now.slice(0,13)+':'+hash;
 const daily=cap(env.AMAP_PUBLIC_PROXY_DAILY_LIMIT,5000,50000),hourly=cap(env.AMAP_PUBLIC_PROXY_IP_HOURLY_LIMIT,200,5000);
 const results=await env.DB.batch([
  env.DB.prepare('DELETE FROM public_map_usage WHERE day<?').bind(day),
  env.DB.prepare('INSERT INTO public_map_usage(bucket,day,used) SELECT ?,?,1 WHERE COALESCE((SELECT used FROM public_map_usage WHERE bucket=?),0)<? AND COALESCE((SELECT used FROM public_map_usage WHERE bucket=?),0)<? ON CONFLICT(bucket) DO UPDATE SET used=used+1').bind(global,day,global,daily,client,hourly),
  env.DB.prepare('INSERT INTO public_map_usage(bucket,day,used) SELECT ?,?,1 WHERE COALESCE((SELECT used FROM public_map_usage WHERE bucket=?),0)<? ON CONFLICT(bucket) DO UPDATE SET used=used+1').bind(client,day,client,hourly)
 ]);
 return results[1].meta.changes===1&&results[2].meta.changes===1;
}
export async function publicMapProxy(req,env){
 const config=publicMapConfig(env),url=new URL(req.url);
 if(!config.webReady)return response('公共底图尚未配置，可直接使用外部地图，或在高级设置填写个人 API。',410);
 if(req.method!=='GET')return response('公共地图只接受读取请求',405);
 if(!['/_AMapService/v3/ias','/_AMapService/v3/assistant/coordinate/convert'].includes(url.pathname))return response('公共地图仅开放底图认证与单点坐标转换，不提供搜索、地理编码或路线规划代理。',403);
 const origin=env.APP_ORIGIN||url.origin;
 if((req.headers.get('Origin')&&req.headers.get('Origin')!==origin)||req.headers.get('Sec-Fetch-Site')==='cross-site')return response('请从本应用打开公共地图',403);
 if(req.headers.get('Referer')){try{if(new URL(req.headers.get('Referer')).origin!==origin)return response('来源不受信任',403);}catch{return response('来源不受信任',403);}}
 if(url.search.length>8192||url.searchParams.has('jscode')||url.searchParams.getAll('key').length>1||(url.searchParams.has('key')&&url.searchParams.get('key')!==config.webKey))return response('代理只接收开发者公共 Key，不接收个人 Key 或安全密钥。',400);
 const callback=url.searchParams.get('callback');if(callback&&!/^[\w$.]{1,120}$/.test(callback))return response('回调格式无效',400);
 if(url.pathname.endsWith('/convert')&&!/^\d{1,3}(?:\.\d+)?,\d{1,2}(?:\.\d+)?$/.test(url.searchParams.get('locations')||''))return response('公共地图只转换一个定位点',400);
 if(!await allowance(req,env))return response('公共地图访问额度暂时用尽，可稍后重试或打开外部地图。',429);
 const target=new URL(url.pathname.slice('/_AMapService'.length),'https://restapi.amap.com');target.search=url.search;
 target.searchParams.set('key',config.webKey);target.searchParams.set('jscode',env.AMAP_PUBLIC_SECURITY_JS_CODE);
 let upstream;try{upstream=await fetch(target,{headers:{Referer:origin+'/',Origin:origin},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{return response('公共地图服务连接失败，可改用外部地图。',502);}
 if(!upstream.ok)return response('公共地图上游服务暂不可用',502);
 const reader=upstream.body?.getReader();if(!reader)return response('公共地图响应为空',502);
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();return response('公共地图响应超限',502);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const content=new TextDecoder().decode(bytes).replaceAll(env.AMAP_PUBLIC_SECURITY_JS_CODE,'[redacted]');
 return new Response(content,{headers:{'Content-Type':callback?'application/javascript; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
