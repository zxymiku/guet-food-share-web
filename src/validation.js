export class InputError extends Error {}
export const categories = ['中餐', '小吃', '面馆', '咖啡', '甜品', '其他'];
function clean(value, name, max, required = false) {
  if (typeof value !== 'string') { if (required) throw new InputError(`${name}不能为空`); return ''; }
  const result = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ((required && !result) || result.length > max) throw new InputError(`${name}需要填写且不能超过 ${max} 字`);
  return result;
}
export function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('投稿格式不正确');
  if (input.consent !== true) throw new InputError('请确认公开投稿内容的授权');
  const {lng, lat} = input.location || {};
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < 73 || lng > 136 || lat < 3 || lat > 54) throw new InputError('请在中国大陆范围选择有效的地图坐标');
  if (input.location.crs !== 'GCJ-02') throw new InputError('坐标系必须是高德 GCJ-02');
  if (!categories.includes(input.category)) throw new InputError('请选择有效分类');
  const photos = input.photos ?? [];
  if (!Array.isArray(photos) || photos.length > 6 || photos.some(p => typeof p !== 'string' || !/^\/api\/photos\/[0-9a-f-]{36}$/.test(p))) throw new InputError('最多上传 6 张本站照片');
  const videos=input.videos??[];
  if(!Array.isArray(videos)||videos.length>2||videos.some(p=>typeof p!=='string'||!/^\/api\/media\/[0-9a-f-]{36}$/.test(p)))throw new InputError('最多上传 2 个本站视频');
  return {schemaVersion: 2, name: clean(input.name, '店名', 60, true), category: input.category,
    address: clean(input.address, '地址', 200, true), description: clean(input.description, '推荐理由', 1000),
    directions: clean(input.directions, '前往方法', 1000),
    location: {lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)), crs: 'GCJ-02'},
    photos: [...new Set(photos)], videos:[...new Set(videos)], consent: true};
}
