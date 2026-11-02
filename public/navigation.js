function point(p){const c=p.location;if(!c||!Number.isFinite(c.lng)||!Number.isFinite(c.lat)||Math.abs(c.lng)>180||Math.abs(c.lat)>90)throw new Error('地点坐标无效');return c;}
export function navigationLinks(place){
 const {lng,lat}=point(place),name=String(place.name||'目的地').replace(/[|,\r\n]/g,' ').trim();
 const amap=new URL('https://uri.amap.com/navigation');amap.search=new URLSearchParams({to:`${lng},${lat},${name}`,mode:'walk',coordinate:'gaode',callnative:'1',src:'guet-food-share'});
 // URI product links, not the REST Direction API; never include a personal key.
 const baidu=new URL('https://api.map.baidu.com/direction');baidu.search=new URLSearchParams({origin:'我的位置',destination:`latlng:${lat},${lng}|name:${name}`,mode:'walking',coord_type:'gcj02',output:'html',src:'webapp.guet.foodshare'});
 return [{name:'高德地图',url:amap.href},{name:'百度地图',url:baidu.href}];
}
export function positionLinks(lng,lat){
 point({location:{lng,lat}});
 const amap=new URL('https://uri.amap.com/marker');amap.search=new URLSearchParams({position:`${lng},${lat}`,name:'我的位置',coordinate:'wgs84',callnative:'0',src:'guet-food-share'});
 const baidu=new URL('https://api.map.baidu.com/marker');baidu.search=new URLSearchParams({location:`${lat},${lng}`,title:'我的位置',content:'设备定位结果，请核对定位精度',coord_type:'wgs84',output:'html',src:'webapp.guet.foodshare'});
 return [{name:'在高德查看定位结果',url:amap.href},{name:'在百度查看定位结果',url:baidu.href}];
}
