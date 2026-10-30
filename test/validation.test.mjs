import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,InputError} from '../src/validation.js';
const valid=()=>({name:'  小店  ',address:'北京 海淀',category:'面馆',location:{lng:116.3974289,lat:39.9092301,crs:'GCJ-02'},photos:[],consent:true});
test('canonical text and GCJ-02 precision; strips unknown attributes',()=>{const result=normalize({...valid(),name:'Ａ 店\n  面馆',admin:true});assert.equal(result.name,'A 店 面馆');assert.equal(result.location.lng,116.397429);assert.equal(result.admin,undefined);assert.deepEqual(normalize(result),result);});
test('location is mandatory and numeric',()=>{for(const location of [undefined,{}, {lng:'116',lat:39,crs:'GCJ-02'},{lng:NaN,lat:39,crs:'GCJ-02'},{lng:181,lat:39,crs:'GCJ-02'},{lng:116,lat:39,crs:'WGS84'}])assert.throws(()=>normalize({...valid(),location}),InputError);});
test('explicit authorization required',()=>{for(const consent of [false,undefined,'true',1])assert.throws(()=>normalize({...valid(),consent}),InputError);});
test('rejects missing or oversized text and invalid categories',()=>{for(const patch of [{name:''},{name:'a'.repeat(61)},{address:''},{category:'shell-command'}])assert.throws(()=>normalize({...valid(),...patch}),InputError);});
test('photos must be bounded same-service references',()=>{for(const photos of [['https://evil.test/x.jpg'],Array(7).fill('/api/photos/11111111-1111-1111-1111-111111111111'),'a'])assert.throws(()=>normalize({...valid(),photos}),InputError);const path='/api/photos/11111111-1111-1111-1111-111111111111';assert.deepEqual(normalize({...valid(),photos:[path,path]}).photos,[path]);});
