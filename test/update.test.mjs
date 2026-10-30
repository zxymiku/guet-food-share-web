import test from 'node:test';
import assert from 'node:assert/strict';
import {appUpdate} from '../src/app-update.js';
test('public Android Releases work without a runtime GitHub token',async()=>{
 const original=globalThis.fetch;
 const manifest={packageName:'com.guet.foodshare',versionCode:1005,versionName:'1.0.5',assetName:'app.apk',size:42,sha256:'a'.repeat(64)};
 globalThis.fetch=async(url,options)=>{assert.ok(!options.headers.Authorization);assert.ok(String(url).includes('/releases/latest/download/update.json'));return Response.json(manifest);};
 try{const r=await appUpdate(new Request('https://food.test/api/app-update'),{GITHUB_REPO:'test/app'});const data=await r.json();assert.equal(data.versionCode,1005);assert.equal(data.downloadPath,'/api/app-download/1005');}finally{globalThis.fetch=original;}
});
