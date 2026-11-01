// Session-only shuffle bag. Choices never change filters or write private data.
export function createDecisionDeck(random=Math.random){
 let signature='',remaining=[],previous=[];
 return {draw(places,size=3){
  const pool=new Map(places.map(p=>[p.id,p]));
  const nextSignature=JSON.stringify([...pool.keys()].sort());
  if(signature!==nextSignature){signature=nextSignature;remaining=[];previous=[];}
  let restarted=false;
  if(!remaining.length&&pool.size){
   restarted=previous.length>0;
   remaining=[...pool.keys()];
   for(let i=remaining.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
   // After exhausting a round, show alternatives to the preceding batch first.
   remaining=[...remaining.filter(id=>!previous.includes(id)),...remaining.filter(id=>previous.includes(id))];
  }
  const ids=remaining.splice(0,Math.max(1,Math.min(3,size)));
  previous=ids;
  return {places:ids.map(id=>pool.get(id)),remaining:remaining.length,total:pool.size,restarted};
 }};
}
