import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecisionDeck} from '../public/decision.js';
import {discover,distanceKm} from '../public/discovery.js';

const candidates=()=>Array.from({length:7},(_,i)=>({id:String(i),name:'门店 '+i,category:'餐厅',location:{lat:25.2,lng:110.3+i*0.01},pricePerPerson:i*5}));
test('decision rounds exhaust all candidates and avoid the previous batch at restart',()=>{
 const pool=candidates(),before=JSON.stringify(pool),deck=createDecisionDeck(()=>0.4);
 const batches=[deck.draw(pool),deck.draw([...pool].reverse()),deck.draw(pool)];
 assert.deepEqual(batches.map(b=>b.places.length),[3,3,1]);
 assert.deepEqual(batches.map(b=>b.remaining),[4,1,0]);
 assert.equal(new Set(batches.flatMap(b=>b.places.map(p=>p.id))).size,7);
 const restarted=deck.draw(pool);assert.ok(restarted.restarted);
 assert.ok(restarted.places.every(p=>p.id!==batches[2].places[0].id));
 assert.equal(JSON.stringify(pool),before,'drawing must not reorder or change source data');
});
test('changed scope resets the round; empty, singleton, duplicates and refreshed data are safe',()=>{
 const pool=candidates(),deck=createDecisionDeck(()=>0);
 const first=deck.draw(pool),remainingId=pool.find(p=>!first.places.some(x=>x.id===p.id)).id;
 const updated=pool.map(p=>({...p,name:'刷新后的 '+p.id}));
 assert.ok(deck.draw(updated).places.every(p=>p.name.startsWith('刷新后的')));
 const one=pool.filter(p=>p.id===remainingId);assert.equal(deck.draw(one).places[0].id,remainingId);
 assert.equal(deck.draw([...one,...one]).total,1);
 assert.deepEqual(deck.draw([]).places,[]);
 assert.equal(deck.draw(one).remaining,0);
});
test('radius needs an origin and budget never substitutes unknown prices with zero',()=>{
 const pool=candidates(),origin=pool[0].location;
 assert.deepEqual(discover(pool,{radius:'0.5',origin}).map(p=>p.id),['0']);
 assert.equal(discover(pool,{radius:'1'}).length,0);
 const distance=distanceKm(origin,pool[1].location);
 assert.equal(discover([pool[1]],{radius:String(distance),origin}).length,1);
 assert.deepEqual(discover([pool[0],{...pool[1],pricePerPerson:null}],{budget:'0'}).map(p=>p.id),['0']);
});
