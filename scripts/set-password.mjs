import {emitKeypressEvents} from 'node:readline';
import {pbkdf2,randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function hidden(prompt){
 if(!process.stdin.isTTY)throw new Error('请在自己的交互终端运行此命令；不要将密码放进命令参数或聊天。');
 emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write(prompt);
 return new Promise((resolve,reject)=>{
  let value='';
  function finish(error){process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);}
  function key(text,pressed){
   if(pressed?.ctrl&&pressed.name==='c'){finish(new Error('已取消'));return;}
   if(pressed?.name==='return'){finish();return;}
   if(pressed?.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
   if(!pressed?.ctrl&&!pressed?.meta&&text&&!/[\u0000-\u001f\u007f]/.test(text)&&value.length+text.length<=128)value+=text;
  }
  process.stdin.on('keypress',key);
 });
}
try{
 let password=await hidden('设置共享密码（12～128 字符，输入不会显示）：');
 if(password.length<12)throw new Error('密码至少 12 字符，建议使用 16 字符以上的随机密码。');
 const confirmation=await hidden('再输入一次：');if(password!==confirmation)throw new Error('两次密码不同，未保存。');
 const salt=randomBytes(16),hash=await promisify(pbkdf2)(password,salt,100000,32,'sha256');password='';
 const descriptor=`pbkdf2-sha256$100000$${salt.toString('hex')}$${hash.toString('hex')}`;
 if(process.argv.includes('--print')){process.stdout.write('将下面整行粘贴到 Worker Secret PASSWORD_CREDENTIAL（验证器也不要提交仓库）：\n'+descriptor+'\n');}
 else if(process.argv.includes('--local')){
  const path=new URL('../.dev.vars',import.meta.url);let contents='';try{contents=await readFile(path,'utf8');}catch{}
  contents=contents.replace(/^PASSWORD_CREDENTIAL=.*(?:\r?\n|$)/gm,'');await writeFile(path,contents.trimEnd()+'\nPASSWORD_CREDENTIAL='+descriptor+'\n',{mode:0o600});
  process.stdout.write('已更新被 Git 忽略的 .dev.vars，仅保存加盐验证器。\n');
 }else{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'secret','put','PASSWORD_CREDENTIAL'],{cwd:root,stdio:['pipe','inherit','inherit']});
  child.stdin.end(descriptor+'\n');const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});if(code!==0)throw new Error('上传 Worker Secret 失败，未启用新密码。如果提示最新版本尚未部署，请先核对并部署当前配置，再重新运行本命令；不要将原密码发到聊天或 Issue。');
  process.stdout.write('共享密码已配置。仅向需要上传美食的人提供原密码；修改验证器会使旧密码会话失效。\n');
 }
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
