(function(root){
'use strict';
const kinds={products:'product',customers:'customer',orders:'order',cashFlows:'cash',debtLedger:'debt'};
const fields=Object.fromEntries(Object.entries(kinds).map(([k,v])=>[v,k]));
const clone=x=>JSON.parse(JSON.stringify(x));
const key=r=>r.kind+':'+r.entity_id;
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function normalized(db){const all=[];for(const [field,kind] of Object.entries(kinds))for(const r of db[field]||[])if(r&&r.id!=null)all.push({kind,entity_id:String(r.id),payload:clone(r)});return all;}
function merge(local,remote){const lm=new Map(normalized(local).map(x=>[key(x),x]));const additions=[],conflicts=[];for(const r of remote){const old=lm.get(key(r));if(!old)additions.push(r);else if(stable(old.payload)!==stable(r.payload))conflicts.push({local:old,remote:r});}return {additions,conflicts};}
function getDeviceId(store){let id=store.getItem('sooi_sync_v2_device');if(!id){id='dev-'+(root.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));store.setItem('sooi_sync_v2_device',id);}return id;}
function mapRecords(db){return new Map(normalized(db).map(r=>[key(r),r.payload]));}
function put(db,k,payload){const i=k.indexOf(':'),field=fields[k.slice(0,i)],id=k.slice(i+1);if(!field)return;db[field]||=[];const pos=db[field].findIndex(x=>String(x.id)===id);if(payload===null){if(pos>=0)db[field].splice(pos,1);}else if(pos<0)db[field].push(clone(payload));else db[field][pos]=clone(payload);}
function plan(base,local,remote){const ops=[],apply=[],conflicts=[];const keys=new Set([...base.keys(),...local.keys(),...remote.keys()]);for(const k of keys){const b=base.get(k),l=local.get(k),r=remote.get(k);const be=b?.payload,le=l,re=r?.payload;const lv=stable(le),bv=stable(be),rv=stable(re);if(!b){if(l!==undefined&&r===undefined)ops.push({key:k,payload:l,expected:0});else if(l===undefined&&r!==undefined)apply.push({key:k,payload:re});else if(l!==undefined&&r!==undefined&&lv!==rv)conflicts.push(k);continue;}
const localChanged=lv!==bv,remoteChanged=rv!==bv;
if(localChanged&&remoteChanged&&lv!==rv){conflicts.push(k);continue;}
if(localChanged&&!remoteChanged)ops.push({key:k,payload:l===undefined?null:l,expected:b.version});
else if(!localChanged&&remoteChanged)apply.push({key:k,payload:re===undefined?null:re});
}return {ops,apply,conflicts};}
// Calls a SECURITY INVOKER-compatible RPC with atomic compare-and-swap revision checking.
async function sync(client,uid,db,persist,render,store=root.localStorage){
if(!client||!uid)throw Error('Chưa đăng nhập');
const baseKey='sooi_v2_base:'+uid,device=getDeviceId(store);
const baseRaw=JSON.parse(store.getItem(baseKey)||'{}');const base=new Map(Object.entries(baseRaw));
const local=mapRecords(db);
const {data,error}=await client.from('sooi_v2_entities').select('kind,entity_id,payload,revision,is_deleted').eq('user_id',uid);
if(error)throw Error('Không đọc được dữ liệu: '+error.message);
const remote=new Map((data||[]).map(r=>[key(r),{payload:r.is_deleted?null:r.payload,version:r.revision}]));
// First run on a device with local data and remote data intentionally requires review.
if(!store.getItem(baseKey)&&local.size&&remote.size){
const first=plan(new Map(),local,remote);if(first.conflicts.length){return {ok:false,message:'Dữ liệu máy và cloud chưa có lịch sử chung. Dừng để tránh ghi đè; hãy sao lưu và đối chiếu trước.',conflicts:first.conflicts};}}
const p=plan(base,local,remote);
if(p.conflicts.length){store.setItem('sooi_v2_conflicts',JSON.stringify(p.conflicts));return {ok:false,message:'Có '+p.conflicts.length+' bản ghi xung đột. Đã tạm dừng để bảo vệ dữ liệu.',conflicts:p.conflicts};}
// Checkpoint each acknowledged write, so a dropped connection mid-batch
// never makes retries conflict with our own successfully uploaded rows.
const checkpoint=new Map(base);
const saveCheckpoint=()=>store.setItem(baseKey,JSON.stringify(Object.fromEntries(checkpoint)));
const written=[];
for(const op of p.ops){const sep=op.key.indexOf(':');const kind=op.key.slice(0,sep),entity=op.key.slice(sep+1);
const {data:result,error:e}=await client.rpc('sooi_v2_cas',{p_kind:kind,p_entity_id:entity,p_payload:op.payload??{},p_expected_revision:op.expected,p_is_deleted:op.payload===null,p_writer_id:device});
if(e)throw Error('Lỗi gửi bản ghi '+op.key+': '+e.message);
if(!result) return {ok:false,message:'Có thay đổi đồng thời ở '+op.key+'. Hãy đồng bộ lại để đối chiếu; chưa ghi đè.'};
written.push(op.key);remote.set(op.key,{payload:op.payload,version:op.expected+1});
checkpoint.set(op.key,{payload:op.payload,version:op.expected+1});saveCheckpoint();}
for(const a of p.apply)put(db,a.key,a.payload);
if(p.apply.length){persist();render();}
const latest={};for(const [k,r] of remote)latest[k]={payload:r.payload,version:r.version};
store.setItem(baseKey,JSON.stringify(latest));store.removeItem('sooi_v2_conflicts');
return {ok:true,added:p.apply.length,sent:written.length,message:'Đồng bộ: nhận '+p.apply.length+', gửi '+written.length+' thay đổi.'};
}
const api={normalized,merge,plan,sync,getDeviceId,stable};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.SooiSyncV2=api;
})(typeof window!=='undefined'?window:globalThis);
