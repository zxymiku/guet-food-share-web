import {encryptionKey,seal,unseal} from './crypto.js';
import {InputError} from './validation.js';
const CHUNK=256*1024;
const mediaToken=env=>env.MEDIA_GITHUB_TOKEN||env.GITHUB_TOKEN;
const githubHeaders=env=>({...mediaToken(env)?{Authorization:`Bearer ${mediaToken(env)}`}:{},Accept:'application/vnd.github+json','User-Agent':'guet-food-share','X-GitHub-Api-Version':'2022-11-28'});
async function gh(env,path,method='GET',data) {
 const r=await fetch(`https://api.github.com/repos/${env.MEDIA_REPO}${path}`,{method,headers:githubHeaders(env),body:data?JSON.stringify(data):undefined});
 if(!r.ok)throw new Error(`Media GitHub request failed (${r.status})`);return r.json();
}
async function release(env){
 const base='media-'+new Date().toISOString().slice(0,10);
 for(let index=0;index<100;index++) {
  const tag=base+'-'+index,r=await fetch(`https://api.github.com/repos/${env.MEDIA_REPO}/releases/tags/${tag}`,{headers:githubHeaders(env)});
  if(r.ok){const found=await r.json();if(found.assets.length<900)return found;continue;}
  if(r.status!==404)throw new Error('Media release lookup failed');
  const create=await fetch(`https://api.github.com/repos/${env.MEDIA_REPO}/releases`,{method:'POST',headers:githubHeaders(env),body:JSON.stringify({tag_name:tag,name:'桂电美食分享 · 加密媒体 '+tag.slice(6),body:'图片和视频以 AES-256-GCM 密文保存；内容经应用审核授权后访问。请勿删除仍在使用的附件。',make_latest:'false'})});
  if(create.ok)return create.json();if(create.status!==422)throw new Error('Media release creation failed');
 }
 throw new Error('Media release capacity reached');
}
function sniff(bytes,mime){
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 if(mime==='video/mp4')return bytes.length>=12&&String.fromCharCode(...bytes.slice(4,8))==='ftyp';
 if(mime==='video/webm')return bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
 return false;
}
// Each chunk has an independent random IV and authenticated ID/index/length.
// Bounded buffers avoid placing a full video into the Worker's 128 MB heap.
export async function encryptedStream(stream,key,id,size,mime) {
 let buffer=new Uint8Array(0),total=0,index=0,checked=false;
 const aad=i=>new TextEncoder().encode(`${id}:${i}:${size}`);
 const block=async(bytes,controller)=>{const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(index++)},key,bytes));controller.enqueue(iv);controller.enqueue(encrypted);};
 return stream.pipeThrough(new TransformStream({
  async transform(chunk,controller){total+=chunk.length;if(total>size)throw new InputError('媒体大小超出声明');const joined=new Uint8Array(buffer.length+chunk.length);joined.set(buffer);joined.set(chunk,buffer.length);buffer=joined;
   if(!checked&&buffer.length>=12){if(!sniff(buffer,mime))throw new InputError('媒体格式与文件内容不符');checked=true;}
   while(buffer.length>=CHUNK){await block(buffer.slice(0,CHUNK),controller);buffer=buffer.slice(CHUNK);}
  },
  async flush(controller){if(total!==size||!checked)throw new InputError('媒体文件不完整或无法识别');if(buffer.length)await block(buffer,controller);}
 }));
}
export async function uploadMedia(req,env,user) {
 if(!mediaToken(env)||!/^[-\w.]+\/[-\w.]+$/.test(env.MEDIA_REPO||''))throw new InputError('请先配置 GitHub 媒体仓库');
 const mime=req.headers.get('Content-Type')?.split(';')[0],video=mime?.startsWith('video/');
 if(!['image/jpeg','image/png','video/mp4','video/webm'].includes(mime))throw new InputError('支持 JPEG、PNG、MP4、WebM');
 const size=Number(req.headers.get('X-File-Size')||req.headers.get('Content-Length'));
 if(!Number.isSafeInteger(size)||size<12||size>(video?50:8)*1024*1024||!req.body)throw new InputError(video?'视频最大 50 MB':'图片最大 8 MB');
 const count=await env.DB.prepare("SELECT count(*) AS n FROM media WHERE user_id=? AND created_at>datetime('now','-1 day')").bind(user).first();if(count.n>=30)throw new InputError('今日媒体上传次数已达上限');
 const id=crypto.randomUUID(),key=await encryptionKey(env,'media:'+id),target=await release(env);
 const uploadURL=new URL(target.upload_url.split('{')[0]);
 if(uploadURL.protocol!=='https:'||uploadURL.hostname!=='uploads.github.com')throw new Error('Invalid GitHub upload host');
 uploadURL.searchParams.set('name',id+'.gefm');
 let stream=await encryptedStream(req.body,key,id,size,mime),pipe;
 const encryptedSize=size+Math.ceil(size/CHUNK)*28;
 if(typeof FixedLengthStream!=='undefined'){const fixed=new FixedLengthStream(encryptedSize);pipe=stream.pipeTo(fixed.writable);pipe.catch(()=>{});stream=fixed.readable;}
 const response=await fetch(uploadURL,{method:'POST',headers:{...githubHeaders(env),'Content-Type':'application/octet-stream','Content-Length':String(encryptedSize)},body:stream,duplex:'half'});
 if(pipe)await pipe;
 if(!response.ok)throw new Error(`GitHub media upload failed (${response.status})`);
 const asset=await response.json(),descriptor=await seal({assetId:asset.id,mime,size},env,'media-index');
 await env.DB.prepare('INSERT INTO media(id,user_id,kind,descriptor) VALUES (?,?,?,?)').bind(id,user,video?'video':'image',descriptor).run();
 return {url:(video?'/api/media/':'/api/photos/')+id,kind:video?'video':'image',size};
}
async function assetResponse(env,repo,id) {
 const r=await fetch(`https://api.github.com/repos/${repo}/releases/assets/${id}`,{headers:{...githubHeaders(env),Accept:'application/octet-stream'},redirect:'manual'});
 if(r.status===302){const target=new URL(r.headers.get('Location'));if(target.protocol!=='https:'||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname))throw new Error('Unexpected GitHub asset host');return fetch(target,{headers:{Accept:'application/octet-stream'}});}
 return r;
}
export {assetResponse};
export async function serveMedia(req,env,row) {
 const meta=await unseal(row.descriptor,env,'media-index');
 let start=0,end=meta.size-1,partial=false;const range=req.headers.get('Range');
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}else start=Math.max(0,meta.size-Number(match[2]));end=Math.min(end,meta.size-1);if(start>end||start<0||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});partial=true;}
 const upstream=await assetResponse(env,env.MEDIA_REPO,meta.assetId);if(!upstream.ok||!upstream.body)throw new Error('Media download failed');
 const key=await encryptionKey(env,'media:'+row.id),reader=upstream.body.getReader();let pending=new Uint8Array(0),index=0,position=0;
 const stream=new ReadableStream({async pull(controller){try{
   while(true){const length=Math.min(CHUNK,meta.size-position);if(length<=0){controller.close();await reader.cancel();return;}const needed=length+28;
    while(pending.length<needed){const {done,value}=await reader.read();if(done)throw new Error('Truncated encrypted media');const all=new Uint8Array(pending.length+value.length);all.set(pending);all.set(value,pending.length);pending=all;}
    const block=pending.slice(0,needed);pending=pending.slice(needed);
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:block.slice(0,12),additionalData:new TextEncoder().encode(`${row.id}:${index++}:${meta.size}`)},key,block.slice(12)));
    const blockStart=position;position+=plain.length;
    if(position>start&&blockStart<=end){controller.enqueue(plain.slice(Math.max(0,start-blockStart),Math.min(plain.length,end-blockStart+1)));if(position>end){controller.close();await reader.cancel();}return;}
   }
  }catch(e){await reader.cancel();controller.error(e);}},cancel(){return reader.cancel();}});
 return new Response(stream,{status:partial?206:200,headers:{'Content-Type':meta.mime,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes',...(partial?{'Content-Range':`bytes ${start}-${end}/${meta.size}`} : {}),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
