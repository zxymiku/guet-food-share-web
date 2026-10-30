const enc=new TextEncoder(),dec=new TextDecoder();
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function encryptionKey(env,purpose) {
 const secret=env.DATA_ENCRYPTION_KEY;
 if(!secret||secret.length<32)throw new Error('DATA_ENCRYPTION_KEY must contain at least 32 characters');
 const root=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('桂电美食分享/v1'),info:enc.encode(purpose)},root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(value,env,purpose='draft') {
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(purpose)},await encryptionKey(env,purpose),enc.encode(JSON.stringify(value)));
 return 'enc1.'+encode(iv)+'.'+encode(data);
}
export async function unseal(value,env,purpose='draft') {
 if(!value.startsWith('enc1.'))return JSON.parse(value); // migration of the original local MVP records
 const [,iv,data]=value.split('.');
 return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:enc.encode(purpose)},await encryptionKey(env,purpose),decode(data))));
}
