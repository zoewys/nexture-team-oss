let snapshot=null
const listeners=new Set()
export const composerBridge={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snapshot,connect(value){snapshot=value;for(const fn of listeners)fn();return()=>{if(snapshot===value){snapshot=null;for(const fn of listeners)fn()}}}}
