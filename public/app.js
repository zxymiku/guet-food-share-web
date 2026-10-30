import {loadCredentials,saveCredentials,clearCredentials} from './map-credentials.js';
import {readAllPlaces,placeArchive} from './place-data.js';
const $=s=>document.querySelector(s);
const state={places:[],category:'全部',user:null,map:null,markers:[],picking:false,selection:null,config:{},authType:null};
const icons={'中餐':'🥢','小吃':'🥟','面馆':'🍜','咖啡':'☕','甜品':'🍰','其他':'🍽️'};
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5500);}
async function api(path,options={}){const r=await fetch(path,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;}
const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function filtered(){const q=$('#search').value.trim().toLowerCase();return state.places.filter(p=>(state.category==='全部'||p.category===state.category)&&[p.name,p.address,p.description].join(' ').toLowerCase().includes(q));}
function render(){
 const places=filtered();$('#count').textContent=`${places.length} 个地点`;$('#list').replaceChildren();
 if(!places.length)$('#list').append(node('div',state.places.length?'没有匹配的地点，试试其他关键词。':'还没有公开地点。分享你发现的第一家好店，审核后就会出现在这里。','empty-list'));
 places.forEach(p=>{const card=node('button',undefined,'place-card');const thumb=p.photos.length?node('img'):node('div',icons[p.category],'thumb');thumb.className='thumb';if(p.photos.length){thumb.src=p.photos[0];thumb.alt=p.name+'门店照片';thumb.loading='lazy';}const copy=node('div');copy.append(node('h3',p.name),node('span',p.category,'tag'),node('p',p.address));card.append(thumb,copy);card.onclick=()=>select(p);$('#list').append(card);});
 if(state.map){state.map.remove(state.markers);state.markers=places.map((p,i)=>{const content=node('div',undefined,'pin');content.append(node('span',String(i+1)));const marker=new AMap.Marker({position:[p.location.lng,p.location.lat],content,anchor:'bottom-center',title:p.name});marker.on('click',()=>select(p));return marker;});state.map.add(state.markers);}
}
function select(p){const box=$('#detail');box.replaceChildren();const close=node('button','×','close');close.setAttribute('aria-label','关闭地点详情');close.onclick=()=>box.hidden=true;box.append(close,node('h2',p.name),node('span',p.category,'tag'),node('p',p.address));if(p.description)box.append(node('p',p.description));if(p.directions)box.append(node('strong','怎么去'),node('p',p.directions));p.photos.forEach(src=>{const img=node('img');img.src=src;img.alt=p.name+'门店照片';box.append(img);});(p.videos||[]).forEach(src=>{const video=node('video');video.src=src;video.controls=true;video.preload='metadata';video.style.width='100%';box.append(video);});const nav=node('a','高德导航 ↗','primary');nav.href=`https://uri.amap.com/navigation?to=${p.location.lng},${p.location.lat},${encodeURIComponent(p.name)}&mode=walk&coordinate=gaode&callnative=1`;nav.target='_blank';nav.rel='noopener';box.append(node('p',`坐标：${p.location.lng}, ${p.location.lat} · GCJ-02`));if(p.publishedAt)box.append(node('p','公开于 '+new Date(p.publishedAt).toLocaleString('zh-CN')));box.append(node('p'),nav);box.hidden=false;state.map?.setZoomAndCenter(16,[p.location.lng,p.location.lat]);}
async function share(){if(!state.user){toast('请先登录后分享');return;}$('#submit-dialog').showModal();}
$('#share').onclick=share;$('#empty-share').onclick=share;$('#explore').onclick=()=>{$('#detail').hidden=true;};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#search').oninput=render;
['全部',...Object.keys(icons)].forEach(c=>{const b=node('button',c,c==='全部'?'active':'');b.onclick=()=>{state.category=c;$('#filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render();};$('#filters').append(b);});
$('#login').onclick=async()=>{try{if(state.user){await post('/api/logout',{});location.reload();}else{$('#password-error').textContent=state.config.passwordReady?'':'共享密码尚未配置，请联系管理员。';$('#login-dialog').showModal();}}catch(e){toast(e.message);}};
$('#github-login').onclick=async()=>{try{if(state.config.dev){await post('/api/dev-session',{});location.reload();}else if(state.config.loginReady){location.href='/auth/github';}else $('#password-error').textContent='GitHub 登录尚未配置，可改用共享密码。';}catch(e){$('#password-error').textContent=e.message;}};
$('#password-form').onsubmit=async event=>{event.preventDefault();const button=$('#password-submit');button.disabled=true;$('#password-error').textContent='';try{await post('/api/auth/password',{password:$('#shared-password').value,client:'web'});$('#shared-password').value='';location.reload();}catch(e){$('#password-error').textContent=e.message;}finally{button.disabled=false;}};
$('#login-dialog').addEventListener('close',()=>$('#shared-password').value='');
$('#pick').onclick=()=>{if(!state.map){toast('配置高德 Key 后可在地图选点，也可以输入高德坐标');return;}state.picking=true;$('#submit-dialog').close();toast('请点击地图上的门店位置');};
async function fillLocation(point){
 const form=$('#submit-form');form.elements.lng.value=point.lng.toFixed(6);form.elements.lat.value=point.lat.toFixed(6);
 if(state.map){if(state.selection)state.map.remove(state.selection);state.selection=new AMap.Marker({position:[point.lng,point.lat],title:'请核对门店位置'});state.map.add(state.selection);}
 $('#pick-help').textContent='已填写坐标，正在获取附近地址…';
 try{const data=await reverseGeocode(point);if(form.elements.lng.value!==point.lng.toFixed(6)||form.elements.lat.value!==point.lat.toFixed(6))return;form.elements.address.value=data.address||'';const nearby=data.pois.find(p=>p.distance<=80);if(nearby&&!form.elements.name.value)form.elements.name.value=nearby.name;$('#pick-help').textContent='已填写坐标与地址，附近店名仅供参考，请核对门店位置和名称后提交。';}
 catch(e){$('#pick-help').textContent='坐标已填写；'+e.message;}
}
function autoLocate(){
 if(!state.map){toast('高德地图尚未就绪');return;}
 if(!state.user){toast('请先登录后定位填写投稿');return;}
 if(!navigator.geolocation){toast('当前设备不支持定位');return;}
 navigator.geolocation.getCurrentPosition(pos=>{AMap.convertFrom([pos.coords.longitude,pos.coords.latitude],'gps',async(status,result)=>{if(status==='complete'&&result.locations?.length){const p=result.locations[0];state.map.setZoomAndCenter(17,p);if(!$('#submit-dialog').open)$('#submit-dialog').showModal();await fillLocation({lng:p.lng,lat:p.lat});toast('已根据定位填写，请核对实际门店。');}else toast('位置转换失败，请手动移动地图');});},()=>toast('定位未获授权或不可用，你仍可手动选点'),{enableHighAccuracy:true,timeout:15000});
}
$('#locate').onclick=autoLocate;$('#autofill').onclick=autoLocate;
let previewUrls=[];
$('#videos').onchange=()=>{const files=[...$('#videos').files];if(files.length>2||files.some(f=>f.size>50*1024*1024||!['video/mp4','video/webm'].includes(f.type))){$('#videos').value='';toast('最多 2 个 MP4/WebM 视频，每个不超过 50 MB');}$('#video-preview').textContent=[...$('#videos').files].map(f=>f.name).join('、');};
$('#photos').onchange=()=>{previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];$('#photo-preview').replaceChildren();const files=[...$('#photos').files];if(files.length>6||files.some(f=>f.size>8*1024*1024||!['image/jpeg','image/png'].includes(f.type))){$('#photos').value='';toast('请选择最多 6 张 JPEG / PNG 照片，每张不超过 8 MB');return;}files.forEach(f=>{const image=node('img');image.src=URL.createObjectURL(f);previewUrls.push(image.src);image.alt='待上传照片预览';$('#photo-preview').append(image);});};
async function stripMetadata(file){const img=await createImageBitmap(file);try{const canvas=document.createElement('canvas');const scale=Math.min(1,2000/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('照片处理失败')),'image/jpeg',0.86));}finally{img.close();}}
$('#submit-form').onsubmit=async event=>{event.preventDefault();const button=$('#submit-button');button.disabled=true;$('#form-error').textContent='';try{const form=new FormData(event.target);const photos=[];for(const file of $('#photos').files){button.textContent='正在处理照片…';const blob=await stripMetadata(file);const result=await api('/api/photos',{method:'POST',headers:{'Content-Type':'image/jpeg','X-File-Size':String(blob.size)},body:blob});photos.push(result.url);}const videos=[];for(const file of $('#videos').files){button.textContent='正在上传加密视频…';const result=await api('/api/media',{method:'POST',headers:{'Content-Type':file.type,'X-File-Size':String(file.size)},body:file});videos.push(result.url);}button.textContent='正在提交…';const data=Object.fromEntries(form);data.location={lng:Number(form.get('lng')),lat:Number(form.get('lat')),crs:'GCJ-02'};data.photos=photos;data.videos=videos;data.consent=form.get('consent')==='on';const result=await post('/api/submissions',data);$('#submit-dialog').close();event.target.reset();$('#photo-preview').replaceChildren();$('#video-preview').textContent='';previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];if(state.map&&state.selection)state.map.remove(state.selection);state.selection=null;toast(result.message);}catch(e){$('#form-error').textContent=e.message;}finally{button.disabled=false;button.textContent='提交审核 ↗';}};
$('#mine').onclick=async()=>{if(!state.user){toast('请先登录后查看投稿');return;}$('#mine-dialog').showModal();$('#submissions').textContent='正在加载…';try{const {submissions}=await api('/api/submissions');$('#submissions').replaceChildren();if(!submissions.length)$('#submissions').append(node('p','还没有投稿，分享一家你喜欢的店吧。','muted'));for(const s of submissions){const row=node('div',undefined,'submission'),copy=node('div',s.name);copy.append(node('small',new Date(s.createdAt).toLocaleString('zh-CN')));row.append(copy,node('span',({pending:'已保存 · 待送达',queued:'整理 / 审核中',published:'已公开'})[s.status]));if(s.status==='pending'){const retry=node('button','重新送交','link');retry.onclick=async()=>{retry.disabled=true;try{await post(`/api/submissions/${s.id}/retry`,{});$('#mine').click();}catch(e){toast(e.message);}finally{retry.disabled=false;}};row.append(retry);}$('#submissions').append(row);}}catch(e){$('#submissions').textContent=e.message;}};
function reverseGeocode(point){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('地址解析超时，请手动填写')),12000);
  AMap.plugin('AMap.Geocoder',()=>{
   const geocoder=new AMap.Geocoder({extensions:'all',radius:100});
   geocoder.getAddress([point.lng,point.lat],(status,result)=>{
    clearTimeout(timer);
    if(status!=='complete'||!result.regeocode){reject(new Error('个人 Key 地址解析失败，请检查权限和额度，或手动填写'));return;}
    resolve({address:result.regeocode.formattedAddress,pois:(result.regeocode.pois||[]).map(p=>({name:p.name,distance:Number(p.distance)}))});
   });
  });
 });
}
let mapLoading=false;
async function loadMap(){
 if(state.map||mapLoading)return;
 const credentials=loadCredentials();
 if(!credentials){$('#map-status').textContent='待填写个人 API';return;}
 mapLoading=true;$('#map-status').textContent='正在连接高德…';
 try{
  // Direct client integration: neither Key nor securityJsCode is sent to our Worker.
  window._AMapSecurityConfig={securityJsCode:credentials.securityJsCode};
  await new Promise((resolve,reject)=>{
   if(window.AMap){resolve();return;}
   const script=document.createElement('script');
   const cleanup=()=>{clearTimeout(timer);delete window.__mapReady;};
   const timer=setTimeout(()=>{cleanup();script.remove();reject(new Error('地图连接超时，请检查个人 API 和网络'));},18000);
   window.__mapReady=()=>{cleanup();resolve();};
   script.src=`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(credentials.key)}&callback=__mapReady`;
   script.onerror=()=>{cleanup();script.remove();reject(new Error('高德地图加载失败，请检查网络与个人 API'));};
   document.head.append(script);
  });
  state.map=new AMap.Map('map',{zoom:13,center:state.places.length?[state.places[0].location.lng,state.places[0].location.lat]:[110.299121,25.274215],viewMode:'2D'});
  $('#map-empty').hidden=true;$('#map-status').textContent='个人 API · 连接中';
  let loaded=false;const currentMap=state.map;
  state.map.on('complete',()=>{loaded=true;$('#map-status').textContent='高德地图 · 个人 API';});
  setTimeout(()=>{if(!loaded&&state.map===currentMap)$('#map-status').textContent='地图未就绪 · 检查个人 API / 网络';},20000);
  state.map.on('error',()=>{$('#map-status').textContent='地图异常 · 检查个人 API';toast('请检查 JSAPI Key、安全码、域名白名单和额度；可打开“地图 API”修改。');});
  state.map.on('click',e=>{if(!state.picking)return;state.picking=false;const {lng,lat}=e.lnglat;$('#submit-dialog').showModal();fillLocation({lng,lat});});render();
 }catch(e){$('#map-status').textContent='加载失败 · 检查个人 API';toast(e.message);}finally{mapLoading=false;}
}
function mapSettings(){
 const saved=loadCredentials();$('#personal-key').value=saved?.key||'';$('#personal-code').value=saved?.securityJsCode||'';
 $('#remember-map').checked=saved?.remember??true;$('#map-settings-error').textContent='';$('#map-settings-dialog').showModal();
}
$('#map-settings').onclick=mapSettings;$('#empty-settings').onclick=mapSettings;
$('#map-settings-form').onsubmit=event=>{event.preventDefault();try{
 saveCredentials({key:$('#personal-key').value,securityJsCode:$('#personal-code').value},$('#remember-map').checked);
 // Reload clears the SDK singleton and all pending callbacks when switching identities.
 location.reload();
}catch(e){$('#map-settings-error').textContent=e.message||'浏览器未允许本地存储，请调整设置';}};
$('#clear-map').onclick=()=>{try{clearCredentials();location.reload();}catch{$('#map-settings-error').textContent='无法清除，请在浏览器设置中清除本站数据';}};
window.addEventListener('storage',event=>{if(event.key==='guet.amap.personal.v1'||event.key===null)location.reload();});
$('#map-settings-dialog').addEventListener('close',()=>{$('#personal-key').value='';$('#personal-code').value='';});
$('#export-places').onclick=async()=>{
 const button=$('#export-places');button.disabled=true;
 try{const places=await readAllPlaces(api);const blob=new Blob([JSON.stringify(placeArchive(places,location.origin),null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='guet-food-places.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${places.length} 个完整公开地点（包含媒体引用，不含个人 API）`);
 }catch(e){toast(e.message);}finally{button.disabled=false;}
};
async function init(){
 const results=await Promise.allSettled([
  api('/api/config').then(config=>{state.config=config;}),
  api('/api/me').then(me=>{state.user=me.user;state.authType=me.authType;$('#login').textContent=state.user?(me.authType==='credential'?'退出（密码）':'退出登录'):'登录 ↗';}),
  readAllPlaces(api,places=>{state.places=places;render();}).then(places=>{state.places=places;render();})
 ]);
 for(const result of results)if(result.status==='rejected')toast(result.reason.message);
 await loadMap();
}
init();

export {api,post,stripMetadata,toast,state,node};
