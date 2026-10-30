const STORAGE_KEY='guet.amap.personal.v1';
export function validateCredentials(input) {
  const key=input.key.trim(),securityJsCode=input.securityJsCode.trim();
  if(!/^[a-f0-9]{32}$/i.test(key))throw new Error('请填写 32 位高德 Web 端（JSAPI）Key，不要填写 Android 或 Web 服务 Key。');
  if(!/^[a-f0-9]{32}$/i.test(securityJsCode))throw new Error('请填写与该 JSAPI Key 配套的 32 位安全密钥 securityJsCode。');
  return {key,securityJsCode};
}
export function loadCredentials(session,local) {
  try {
    session ??= window.sessionStorage;local ??= window.localStorage;
    const temporary=session.getItem(STORAGE_KEY),saved=temporary||local.getItem(STORAGE_KEY);
    return saved?{...validateCredentials(JSON.parse(saved)),remember:!temporary}:null;
  }catch{return null;}
}
export function saveCredentials(input,remember=true,session=window.sessionStorage,local=window.localStorage) {
  const value=JSON.stringify(validateCredentials(input));
  // Write first: a storage failure must not destroy a previously working setup.
  (remember?local:session).setItem(STORAGE_KEY,value);
  (remember?session:local).removeItem(STORAGE_KEY);
}
export function clearCredentials(session=window.sessionStorage,local=window.localStorage) {
  session.removeItem(STORAGE_KEY);local.removeItem(STORAGE_KEY);
}
