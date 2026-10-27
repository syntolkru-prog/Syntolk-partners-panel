export interface CalendarPlatform {id:string;name:string;formats?:string[]}
export interface CalendarMaterial {
  id:string;title:string;formatId:string;formatName:string;scenarioId:string|null;scheduledDay:string|null;
  platforms:CalendarPlatform[];revision:number;ready:boolean;hasContent:boolean;fileCount:number;
  status:'published'|'partial'|'overdue'|'waiting'|'draft';publishedPlacements:number;totalPlacements:number;
  scheduledTime?:string|null;
}
export interface CalendarData {today:string;materials:CalendarMaterial[];plans:Array<{id:string;startDate:string;days:number;scenarioId:string;scenarioName:string}>}
export type CalendarMode='today'|'week'|'month'|'list';
export const statusLabels={published:'Опубликовано',partial:'Частично опубликовано',overdue:'Не опубликовано',waiting:'Ожидает публикации',draft:'Подготовка'};
export const addDays=(day:string,count:number)=>new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);
export const weekStart=(day:string)=>addDays(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
export const dateLabel=(day:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'short'})=>new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
export function calendarRange(day:string,mode:CalendarMode){
  if(mode==='today')return {start:day,end:day,days:[day]};
  if(mode==='week'){const start=weekStart(day);return {start,end:addDays(start,6),days:Array.from({length:7},(_,i)=>addDays(start,i))};}
  const start=day.slice(0,7)+'-01',end=addDays(new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),1,12)).toISOString().slice(0,10),-1);
  const gridStart=weekStart(start),size=Math.ceil((Date.parse(end)-Date.parse(gridStart))/86400000/7+1/7)*7;
  return {start,end,days:Array.from({length:size},(_,i)=>addDays(gridStart,i))};
}
export function calendarDateRange(start:string,end:string){
  const gridStart=weekStart(start),gridEnd=addDays(weekStart(end),6);
  return {start,end,days:Array.from({length:Math.round((Date.parse(gridEnd)-Date.parse(gridStart))/86400000)+1},(_,i)=>addDays(gridStart,i))};
}
export function moveCalendar(day:string,mode:CalendarMode,direction:number){
  if(mode==='today')return addDays(day,direction);
  if(mode==='week')return addDays(day,7*direction);
  return new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1+direction,1,12)).toISOString().slice(0,10);
}
export function calendarSummary(materials:CalendarMaterial[]){
  const placements=materials.reduce((sum,m)=>sum+m.totalPlacements,0),published=materials.reduce((sum,m)=>sum+m.publishedPlacements,0);
  return {materials:materials.length,ready:materials.filter(m=>m.ready).length,placements,published,percent:placements?Math.round(published/placements*100):0};
}
export function filterCalendar(materials:CalendarMaterial[],search:string,status:string,format:string){
  const term=search.toLocaleLowerCase('ru-RU').trim();
  return materials.filter(m=>(!status||m.status===status)&&(!format||m.formatId===format)&&(!term||[m.title,m.formatName,...m.platforms.map(p=>p.name)].join(' ').toLocaleLowerCase('ru-RU').includes(term)));
}
export const uploadId=()=>crypto.randomUUID().replaceAll('-','');
export const fileAccept='image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/ogg,application/pdf,text/plain';
export function fileType(file:File){
  const extension=file.name.split('.').at(-1)?.toLowerCase();
  return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',pdf:'application/pdf',txt:'text/plain'} as Record<string,string>)[extension??'']??file.type;
}
