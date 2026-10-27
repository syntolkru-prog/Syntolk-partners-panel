/** Opens the platform's normal UI; never sends a publication or credentials. */
export function publicationPlatformUrl(id:string,savedUrl?:string):string|undefined{
  if(id.startsWith('telegram'))return 'https://web.telegram.org/';
  if(['youtube','ytshorts'].includes(id))return 'https://www.youtube.com/upload';
  if(['vk','vkclips','vkvideo'].includes(id))return 'https://vk.com/';
  const standard=({dzen:'https://dzen.ru/',rutube:'https://rutube.ru/',rutubeshorts:'https://rutube.ru/',tiktok:'https://www.tiktok.com/',ok:'https://ok.ru/',tenchat:'https://tenchat.ru/',vc:'https://vc.ru/',habr:'https://habr.com/',pikabu:'https://pikabu.ru/',spark:'https://spark.ru/'} as Record<string,string>)[id];
  if(standard)return standard;
  if(savedUrl){try{const url=new URL(savedUrl);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{/* A missing or invalid address is not a platform link. */}}
  return undefined;
}
