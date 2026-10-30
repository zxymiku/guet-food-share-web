const article=document.querySelector('#review');
try {
 const id=new URLSearchParams(location.search).get('id');
 if(!/^[0-9a-f-]{36}$/.test(id||''))throw new Error('投稿 ID 无效。请从 GitHub PR 的审核链接打开。');
 const r=await fetch('/api/review/'+id);const p=await r.json();if(!r.ok)throw new Error(p.error);
 document.querySelector('#message').textContent='请审核以下内容，再回到 GitHub PR 决定是否合并。';
 for(const [label,value] of [['店名',p.name],['分类',p.category],['地址',p.address],['推荐理由',p.description],['前往方法',p.directions],['高德 GCJ-02 坐标',`${p.location.lng}, ${p.location.lat}`],['状态',p.status]]){const h=document.createElement('h3');h.textContent=label;const text=document.createElement('p');text.textContent=value||'未填写';text.style.whiteSpace='pre-wrap';article.append(h,text);}
 for(const src of p.photos){const img=document.createElement('img');img.src=src;img.alt='待审核门店照片';img.style.cssText='max-width:100%;max-height:500px;display:block;margin:20px 0';article.append(img);}
 for(const src of p.videos||[]){const video=document.createElement('video');video.src=src;video.controls=true;video.preload='metadata';video.style.cssText='max-width:100%;display:block;margin:20px 0';article.append(video);}
 const link=document.createElement('a');link.textContent='在高德地图检查位置 ↗';link.href=`https://uri.amap.com/marker?position=${p.location.lng},${p.location.lat}&name=${encodeURIComponent(p.name)}&coordinate=gaode`;link.target='_blank';link.rel='noopener';article.append(link);
} catch(e){document.querySelector('#message').textContent=e.message;}
