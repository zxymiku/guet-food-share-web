import {InputError} from './validation.js';
export const fallback={version:1,categories:[{name:'后街',children:[]},{name:'前街',children:[]},{name:'餐厅',children:['中餐','小吃','面馆','咖啡','甜品','其他']}]};
export function validateCategories(value){
 if(value?.version!==1||!Array.isArray(value.categories)||!value.categories.length||value.categories.length>20)throw new InputError('分类配置无效');
 const names=new Set();
 for(const c of value.categories){if(typeof c.name!=='string'||!c.name.trim()||c.name.length>30||names.has(c.name)||!Array.isArray(c.children)||c.children.length>40||c.children.some(x=>typeof x!=='string'||!x.trim()||x.length>30)||new Set(c.children).size!==c.children.length)throw new InputError('分类配置重复或格式错误');names.add(c.name);}
 return value;
}
export async function categoryConfig(req,env){try{return validateCategories(await (await env.ASSETS.fetch(new Request(new URL('/categories.json',req.url)))).json());}catch{console.error('Invalid category config; using safe defaults');return fallback;}}
