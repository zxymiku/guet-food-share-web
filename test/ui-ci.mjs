// Focused remote-only UI check. API fixtures are not production or real AMap authentication.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture={id:'11111111-1111-4111-8111-111111111111',name:'CI 测试地点',category:'餐厅',subcategory:'面馆',address:'仅用于界面验收',description:'测试描述',location:{lng:110.3,lat:25.2,crs:'GCJ-02'},photos:[],videos:[],pros:'可选优点',cons:'可选缺点',menuPrice:'测试价格'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;
 const apis={'/api/categories':JSON.parse(await readFile(new URL('../public/categories.json',import.meta.url),'utf8')),'/api/config':{passwordReady:true},'/api/me':{user:null},'/api/places':{places:[fixture],nextCursor:null},[`/api/places/${fixture.id}/reviews`]:{count:0,average:null,reviews:[],nextCursor:null}};
 if(apis[path]){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(apis[path]));}
 const file=path==='/'?'index.html':path.slice(1);if(file.includes('..'))throw new Error();const data=await readFile(new URL('../public/'+file,import.meta.url));res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'text/html');res.end(data);
 }catch{res.statusCode=404;res.end();}
});await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
const browser=await chromium.launch();await mkdir('artifacts',{recursive:true});
try{for(const [name,width,height] of [['desktop',1440,1000],['portrait',390,844]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173/');await page.locator('#guide-dialog').waitFor({state:'visible'});await page.locator('#guide-finish').click();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#toast').isVisible(),false);
 await page.getByRole('button',{name:/CI 测试地点/}).click();await page.locator('#detail form').waitFor();assert.ok((await page.locator('#detail').innerText()).includes('测试价格'));
 await page.screenshot({path:`artifacts/${name}-detail.png`,fullPage:true});await page.locator('#detail .close').click();
 await page.locator('#map-settings').click();await page.locator('#map-settings-dialog .guide-link').click();await page.frameLocator('#readme-dialog iframe').getByRole('heading',{name:/高德/,level:1}).waitFor();await page.locator('#readme-dialog .close').click();await page.locator('#map-settings-dialog .close').click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');await page.reload();assert.equal(await page.locator('#guide-dialog').isVisible(),false);await page.locator('#guide-open').click();await page.locator('#guide-finish').click();assert.deepEqual(errors,[]);
 await page.screenshot({path:`artifacts/${name}-atlas.png`,fullPage:true});await page.close();
}}finally{await browser.close();server.close();}
