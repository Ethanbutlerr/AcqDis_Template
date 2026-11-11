const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost'});
global.window=dom.window; global.document=dom.window.document; global.navigator=dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'); const {createRoot}=require('react-dom/client'); const {act}=require('react-dom/test-utils');
const h=React.createElement;
const rootPath=path.join(__dirname,'../..');
let profile={id:'user-a',company_id:'company-a'}, refresh, notices=[], roots=[], errors=[], navigations=[], readGate=null, rpcGate=null, saveError=false;
const refreshers={};
const dashboardKpis={total_leads:1250,assigned_leads:1000,unassigned_leads:250,open_deals:13,contracts_executed:13,closings:0,company_revenue:0,personal_earnings:0,overdue_tasks:0};
let dashboardGate=null;
const copy=(v)=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const rpcResult={managers:[{user_id:'user-a',full_name:'Ada',verified_revenue:15000,closed_deals:1,signed_contracts:13,dials_period:10,dials_today:2,dials_week:5}],generated_at:'2026-10-21T10:00:00Z'};
const db={
  rpc:async(name)=>{
    if(name==='get_scoreboard_data') return rpcGate?await rpcGate.promise:{data:copy(rpcResult),error:null};
    if(dashboardGate) await dashboardGate.promise;
    return {data:name==='get_dashboard_kpis'?copy(dashboardKpis):name==='get_dashboard_tasks'?{overdue:[],due_today:[],upcoming:[],assigned_to_me:[]}:name==='get_dead_lost_reasons'?{dead_leads:[],dead_deals:[]}:name==='get_conversion_metrics'?{}:[],error:null};
  },
  from(table){
    let filters=[],mutation=null,head=false,max=Infinity;
    const q={select(_s,options){head=options?.head??false;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},order(){return q;},maybeSingle(){return q;},limit(v){max=v;return q;},update(row){mutation=row;return q;},
      then(resolve,reject){
        const matches=table==='notifications'?notices.filter(r=>filters.every(f=>f(r))):[];
        let result;
        if(mutation){
          if(saveError) result={data:null,error:{message:'Database unavailable'},count:null};
          else {matches.forEach(r=>Object.assign(r,mutation));result={data:copy(matches),count:matches.length,error:null};}
        }else result={data:head||table==='dashboard_preferences'?null:copy(matches.slice(0,max)),count:matches.length,error:null};
        const gate=!mutation&&readGate?readGate.promise:Promise.resolve();
        return gate.then(()=>result).then(resolve,reject);
      }};
    return q;
  }
};
const plain=({children,...props})=>h('div',{},children);
const Button=({children,onClick,disabled,...props})=>h('button',{onClick,disabled,'aria-label':props['aria-label']},children);
const ui=new Proxy({}, {get(_target,key){
  if(key==='Button') return Button;
  if(key==='Skeleton') return ()=>h('div',{'data-skeleton':true});
  if(key==='DropdownMenuItem') return ({children,onSelect,disabled})=>h('div',{role:'menuitem',onClick:disabled?undefined:onSelect},children);
  return plain;
}});
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='@/lib/supabase/client') return {supabase:db};
  if(request==='@/lib/auth/auth-context') return {useAuth:()=>({profile})};
  if(request==='@/lib/auth/use-permissions') return {usePermissions:()=>({hasPermission:(key)=>key==='view_acquisitions'})};
  if(request==='@/lib/auth/branding-context') return {useBranding:()=>({company:{name:'Test company'}})};
  if(request==='@/components/setup-banner') return {SetupBanner:()=>null};
  if(request==='@/hooks/use-crm-refresh') return {useCrmRefresh:(_company,tables,callback)=>{refresh=callback;refreshers[tables.join(',')]=callback;}};
  if(request==='next/navigation') return {useRouter:()=>({push:(url)=>navigations.push(url)})};
  if(request==='sonner') return {toast:{error:(message)=>errors.push(message)}};
  if(request.startsWith('@/components/ui/')) return ui;
  if(request.startsWith('@/')) request=path.join(rootPath,request.slice(2));
  return originalLoad.call(this,request,parent,isMain);
};
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const {NotificationCenter}=require('../../components/notification-center.tsx');
const {AcquisitionsScoreboard}=require('../../components/acquisitions-scoreboard.tsx');
const Dashboard=require('../../app/(app)/dashboard/page.tsx').default;
const {rankManagers}=require('../../lib/utils/scoreboard.ts');
const {parseCSV}=require('../../lib/utils/csv.ts');
const {prepareLeadImport}=require('../../lib/utils/lead-import.ts');
async function mount(component){const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);roots.push({root,container});await act(async()=>{root.render(h(component));});return container;}
async function click(el){assert.ok(el,'Expected control');await act(async()=>{el.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));});}
afterEach(async()=>{for(const {root,container}of roots){await act(async()=>root.unmount());container.remove();}roots=[];readGate=null;rpcGate=null;dashboardGate=null;saveError=false;errors=[];navigations=[];profile={id:'user-a',company_id:'company-a'};});
function seed(count=1){notices=Array.from({length:count},(_,i)=>({id:String(i),company_id:'company-a',user_id:'user-a',type:'missed_call',title:`Call ${i}`,body:'Call details',entity_type:'call',entity_id:`call-${i}`,is_read:false,read_at:null,created_at:'2026-10-21T10:00:00Z'}));}

test('CSV preserves multiline quoted custom information and rejects ambiguous headers',()=>{
  const rows=parseCSV('\uFEFFfirst_name,notes\r\nAda,"line one\nline two, with ""quotes"""\r\n');
  assert.equal(rows[0].notes,'line one\nline two, with "quotes"');
  assert.throws(()=>parseCSV('name,name\nA,B'),/unique/);
  assert.throws(()=>parseCSV('name\n"unterminated'),/unterminated/);
});
test('CSV validates numbers and contacts without discarding zero values',()=>{
  const valid=prepareLeadImport({first_name:'Ada',phone:'(212) 555-0100',asking_price:'$120,000',estimated_repair_cost:'0'});
  assert.deepEqual(valid.errors,[]);assert.equal(valid.property.asking_price,120000);assert.equal(valid.property.estimated_repair_cost,0);
  assert.equal(valid.contact.phone,'12125550100');
  assert.ok(prepareLeadImport({phone:'123',email:'bad',asking_price:'unknown'}).errors.length>=3);
});
test('rank ties use selected metric, share places and do not reward alphabetical order',()=>{
  const row=(name,revenue,contracts)=>({full_name:name,verified_revenue:revenue,signed_contracts:contracts,closed_deals:0,dials_period:0});
  assert.deepEqual(rankManagers([row('B',0,0),row('A',0,0)],'verified_revenue').map(r=>[r.rank,r.has_activity]),[[1,false],[1,false]]);
  const ranked=rankManagers([row('A',10,2),row('B',10,3),row('C',0,3)],'signed_contracts');
  assert.deepEqual(ranked.map(r=>r.rank),[1,1,3]);assert.equal(ranked[2].full_name,'A');
});
test('notification read persists across remount and navigation waits for successful save',async()=>{
  seed();const ui=await mount(NotificationCenter);await click(ui.querySelector('[role=menuitem]'));
  assert.equal(notices[0].is_read,true);assert.deepEqual(navigations,['/conversations']);
  await act(async()=>roots[0].root.unmount());roots[0].container.remove();roots=[];
  const reloaded=await mount(NotificationCenter);assert.match(reloaded.textContent,/all caught up/);
  await click([...reloaded.querySelectorAll('button')].find(b=>b.textContent==='History'));
  assert.match(reloaded.textContent,/Call 0/);
  await click([...reloaded.querySelectorAll('button')].find(b=>b.textContent==='Unread'));
  assert.equal(notices[0].is_read,false);
});
test('mark all read includes notifications beyond the visible page and immediately clears badge',async()=>{
  seed(75);const ui=await mount(NotificationCenter);
  assert.equal(ui.querySelectorAll('[role=menuitem]').length,50);
  await click([...ui.querySelectorAll('button')].find(b=>b.textContent.includes('Mark all read')));
  assert.equal(notices.filter(n=>!n.is_read).length,0);assert.match(ui.textContent,/Unread \(0\)/);
});
test('failed notification writes do not navigate or pretend to save',async()=>{
  seed();saveError=true;const ui=await mount(NotificationCenter);await click(ui.querySelector('[role=menuitem]'));
  assert.equal(notices[0].is_read,false);assert.equal(navigations.length,0);assert.equal(errors.length,1);
});
test('late pre-mutation fetch cannot resurrect unread notification',async()=>{
  seed();const ui=await mount(NotificationCenter);readGate=deferred();let pending;
  await act(async()=>{pending=refresh();await Promise.resolve();});
  await click(ui.querySelector('[role=menuitem]'));
  await act(async()=>{readGate.resolve();await pending;});
  assert.match(ui.textContent,/Unread \(0\)/);assert.equal(ui.querySelectorAll('[role=menuitem]').length,0);
});
test('notification state is scoped to the current company and user',async()=>{
  seed();notices.push({...notices[0],id:'foreign',user_id:'user-b'});
  const ui=await mount(NotificationCenter);assert.equal(ui.querySelectorAll('[role=menuitem]').length,1);
  await click([...ui.querySelectorAll('button')].find(b=>b.textContent.includes('Mark all read')));
  assert.equal(notices.find(n=>n.id==='foreign').is_read,false);
});
test('scoreboard retains loaded results during background refresh and refresh errors',async()=>{
  const ui=await mount(AcquisitionsScoreboard);assert.match(ui.textContent,/15,000/);assert.equal(ui.querySelectorAll('[data-skeleton]').length,0);
  rpcGate=deferred();let pending;await act(async()=>{pending=refresh();});
  assert.match(ui.textContent,/15,000/);assert.equal(ui.querySelectorAll('[data-skeleton]').length,0);
  await act(async()=>{rpcGate.resolve({error:{message:'Temporary error'},data:null});await pending;});
  assert.match(ui.textContent,/15,000/);assert.match(ui.textContent,/Refresh failed/);
});

test('dashboard preserves metric DOM and scoreboard through five background refresh cycles',async()=>{
  const ui=await mount(Dashboard);
  const metric=[...ui.querySelectorAll('div')].find(el=>el.textContent==='1,250');
  assert.ok(metric);assert.match(ui.textContent,/Acquisitions Scoreboard/);
  const reload=refreshers['acquisition_records,disposition_records,revenue_attributions,user_earnings,tasks'];
  for(let i=0;i<5;i++){
    dashboardGate=deferred();let pending;await act(async()=>{pending=reload();});
    assert.ok(metric.isConnected);assert.equal(metric.textContent,'1,250');assert.match(ui.textContent,/Acquisitions Scoreboard/);
    await act(async()=>{dashboardGate.resolve();await pending;});
    assert.ok(metric.isConnected);assert.equal(metric.textContent,'1,250');
  }
});
