import {api,post,stripMetadata,toast,state,node} from './app.js';
const $=s=>document.querySelector(s),dialog=$('#feedback-dialog'),form=$('#feedback-form');
let requestId=crypto.randomUUID(),uploaded=new Map(),previews=[];
function changed(){requestId=crypto.randomUUID();$('#feedback-result').replaceChildren();}
$('#feedback-open').onclick=async()=>{
 dialog.showModal();$('#feedback-error').textContent='';
 try{const config=state.config.feedback||((await api('/api/config')).feedback);$('#feedback-manual').href=config.webIssuesUrl;$('#feedback-note').textContent=config.automaticReady?(state.authType==='credential'?'密码登录：由管理员 GitHub 账号代发到 Web 仓库。':'GitHub 登录：使用你自己的账号发布到 Web 仓库。'):'自动反馈服务待配置；你仍可填写表单，或使用手动反馈。';}catch(e){$('#feedback-note').textContent=e.message;}
};
$('#feedback-auto').onclick=()=>{$('#feedback-auto-panel').hidden=false;$('#feedback-title').focus();};
$('#feedback-title').oninput=changed;$('#feedback-description').oninput=changed;
$('#feedback-images').onchange=()=>{
 changed();uploaded.clear();previews.forEach(URL.revokeObjectURL);previews=[];$('#feedback-preview').replaceChildren();
 const files=[...$('#feedback-images').files];
 if(files.length>3||files.some(f=>f.size>8*1024*1024||!['image/jpeg','image/png'].includes(f.type))){$('#feedback-images').value='';toast('最多 3 张 JPEG / PNG 截图，每张不超过 8 MB');return;}
 for(const file of files){const image=node('img');image.src=URL.createObjectURL(file);image.alt='待提交反馈截图';previews.push(image.src);$('#feedback-preview').append(image);}
};
form.onsubmit=async event=>{
 event.preventDefault();const submit=$('#feedback-submit');$('#feedback-error').textContent='';$('#feedback-result').replaceChildren();
 if(!state.user){$('#feedback-error').textContent='请先使用共享密码或 GitHub 登录后自动反馈。';return;}
 form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);
 try{
  const screenshots=[];
  for(const file of $('#feedback-images').files){
   submit.textContent='正在上传截图…';
   if(!uploaded.has(file)){const blob=await stripMetadata(file);const result=await api('/api/feedback/screenshots',{method:'POST',headers:{'Content-Type':'image/jpeg','X-File-Size':String(blob.size)},body:blob});uploaded.set(file,result.url);}
   screenshots.push(uploaded.get(file));
  }
  submit.textContent='正在创建 Issue…';
  const result=await post('/api/feedback',{requestId,platform:'web',title:$('#feedback-title').value,description:$('#feedback-description').value,screenshots,appVersion:'Web',consent:$('#feedback-consent').checked});
  const link=node('a',`已提交：查看 Issue #${result.number} ↗`,'feedback-result-link');link.href=result.issueUrl;link.target='_blank';link.rel='noopener';$('#feedback-result').append(link);
  form.reset();uploaded.clear();previews.forEach(URL.revokeObjectURL);previews=[];$('#feedback-preview').replaceChildren();requestId=crypto.randomUUID();toast('反馈已发布到 Web 仓库');
 }catch(e){$('#feedback-error').textContent=e.message;}
 finally{form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=false);submit.textContent='提交并创建 GitHub Issue ↗';}
};
