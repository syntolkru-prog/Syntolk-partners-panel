import {useContext,useEffect,useRef} from 'react';
import {UNSAFE_NavigationContext,type Navigator} from 'react-router-dom';

interface Guard {dirty:boolean;busy:boolean;skip:boolean}
interface Guards {items:Set<Guard>;dispose:()=>void}
const registries=new WeakMap<Navigator,Guards>();

/** BrowserRouter navigation guard; drafts remain owned by their existing form. */
export function useUnsavedChanges(dirty:boolean,busy=false) {
  const {navigator}=useContext(UNSAFE_NavigationContext);
  const guard=useRef<Guard>({dirty,busy,skip:false});
  guard.current.dirty=dirty;guard.current.busy=busy;
  useEffect(()=>{
    let registry=registries.get(navigator);
    if(!registry){
      const items=new Set<Guard>();
      let index=window.history.state?.idx as number|undefined,approvedIndex:number|undefined,restoring=false;
      const canLeave=()=>{
        const active=[...items].filter(item=>{if(item.skip){item.skip=false;return false;}return true;});
        if(active.some(item=>item.busy))return false;
        return !active.some(item=>item.dirty)||window.confirm('Есть несохранённые изменения. Уйти без сохранения?');
      };
      const push=navigator.push,replace=navigator.replace,go=navigator.go;
      const guardedPush:Navigator['push']=(...args)=>{if(canLeave()){push.apply(navigator,args);index=window.history.state?.idx;}};
      const guardedReplace:Navigator['replace']=(...args)=>{if(canLeave()){replace.apply(navigator,args);index=window.history.state?.idx;}};
      const guardedGo:Navigator['go']=(delta)=>{if(canLeave()){approvedIndex=typeof index==='number'?index+delta:undefined;go.call(navigator,delta);}};
      const pop=(event:PopStateEvent)=>{
        const next=event.state?.idx as number|undefined;
        if(restoring){restoring=false;index=next;return;}
        if(typeof approvedIndex==='number'&&next===approvedIndex){approvedIndex=undefined;index=next;return;}
        approvedIndex=undefined;
        if(next!==index&&typeof next==='number'&&typeof index==='number'&&!canLeave()){
          event.stopImmediatePropagation();restoring=true;window.history.go(index-next);return;
        }
        index=next;
      };
      const unload=(event:BeforeUnloadEvent)=>{if([...items].some(item=>!item.skip&&(item.dirty||item.busy))){event.preventDefault();event.returnValue='';}};
      navigator.push=guardedPush;navigator.replace=guardedReplace;navigator.go=guardedGo;
      window.addEventListener('popstate',pop,true);window.addEventListener('beforeunload',unload);
      registry={items,dispose:()=>{
        if(navigator.push===guardedPush)navigator.push=push;
        if(navigator.replace===guardedReplace)navigator.replace=replace;
        if(navigator.go===guardedGo)navigator.go=go;
        window.removeEventListener('popstate',pop,true);window.removeEventListener('beforeunload',unload);
      }};
      registries.set(navigator,registry);
    }
    const current=registry;current.items.add(guard.current);
    return()=>{current.items.delete(guard.current);if(!current.items.size){current.dispose();registries.delete(navigator);}};
  },[navigator]);
  return ()=>{guard.current.skip=true;};
}
