import {currentTenantSlug} from '../api.js';

/** A server-side data reset also invalidates saved drafts, while preserving login. */
export function applyCabinetDataRevision(revision?:string,tenant=currentTenantSlug()) {
  if(!revision)return;
  const scope=tenant??'default',marker=`syntolk-cabinet-data-revision:${scope}`;
  try{
    if(localStorage.getItem(marker)===revision)return;
    const prefixes=[`syntolk-partner-forecast-v1:${tenant}:`,`syntolk-partner-selection:${scope}:`,
      `syntolk-partner-base-link:${scope}:`,`syntolk-calculator-fact-views-v1:[${JSON.stringify(tenant)},`,
      `syntolk-coach-invitation:${scope}:`];
    for(const storage of [localStorage,sessionStorage]){
      const keys=Array.from({length:storage.length},(_,index)=>storage.key(index));
      for(const key of keys)if(key&&(prefixes.some(prefix=>key.startsWith(prefix))||tenant===null&&key==='syntolk-partner-forecast-v1'))storage.removeItem(key);
    }
    localStorage.setItem(marker,revision);
  }catch{/* Storage restrictions must not prevent signing in. */}
}
