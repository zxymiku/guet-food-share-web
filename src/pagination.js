import {InputError} from './validation.js';
export function decodeCursor(value){
 if(!value)return null;
 try{if(value.length>400)throw 0;const c=JSON.parse(atob(value));if(!Array.isArray(c)||c.length!==2||typeof c[0]!=='string'||c[0].length>40||!/^\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?$/.test(c[0])||typeof c[1]!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(c[1]))throw 0;return c;}catch{throw new InputError('分页游标无效，请重新加载');}
}
export const encodeCursor=row=>btoa(JSON.stringify([row.created_at,row.id]));
