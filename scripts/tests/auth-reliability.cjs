const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react');const {createRoot}=require('react-dom/client');const {act}=require('react-dom/test-utils');
let ctx,root,callback,profileError=null,missing=false,disabled=false,permError=null,gate=null,calls=[],reads=0;
const user={id:'user-a'};const session={user};
const db={auth:{
  getSession:async()=>({data:{session:null}}),
  onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};},
  signInWithPassword:async()=>{callback('SIGNED_IN',session);return {data:{user,session},error:null};},
  signOut:async()=>{callback('SIGNED_OUT',null);return {error:null};}
},from(table){const q={select(){return q;},eq(){return q;},update(){return q;},then(resolve){return Promise.resolve({error:null}).then(resolve);},async maybeSingle(){
  if(table==='profiles'){reads++;if(gate)await gate;return {data:missing?null:{id:user.id,company_id:'company-a',is_disabled:disabled},error:profileError};}
  return {data:{subscription_status:'active'},error:null};
}};return q;},async rpc(name){calls.push(name);return {data:['view_acquisitions'],error:permError};}};
const original=Module._load;
Module._load=function(name,parent,isMain){if(name==='@/lib/supabase/client')return {supabase:db};return original.call(this,name,parent,isMain);};
require.extensions['.tsx']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const {AuthProvider,useAuth}=require('../../lib/auth/auth-context.tsx');
function Probe(){ctx=useAuth();return null;}
async function mount(){root=createRoot(document.createElement('div'));await act(async()=>root.render(React.createElement(AuthProvider,null,React.createElement(Probe))));}
async function login(){let result;await act(async()=>{result=await ctx.signIn('a@example.com','test');await new Promise(r=>setTimeout(r,5));});return result;}
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;profileError=null;missing=false;disabled=false;permError=null;gate=null;calls=[];reads=0;});
test('REST outage reports service failure and never provisions a company; retry recovers existing session',async()=>{
  await mount();profileError={code:'PGRST002'};
  assert.match((await login()).error,/temporarily unavailable/);
  assert.equal(ctx.profile,null);assert.equal(ctx.user.id,user.id);assert.deepEqual(calls,[]);
  profileError=null;await act(async()=>ctx.refreshProfile());
  assert.equal(ctx.profile.id,user.id);assert.equal(ctx.authError,null);
});
test('missing profile never creates another account',async()=>{
  await mount();missing=true;assert.match((await login()).error,/Contact your administrator/);assert.deepEqual(calls,[]);
});
test('successful login loads account and permissions once despite SIGNED_IN event',async()=>{
  await mount();assert.equal((await login()).error,null);assert.equal(reads,1);
  assert.deepEqual(ctx.permissions,['view_acquisitions']);assert.equal(ctx.profile.company_id,'company-a');
});
test('permission failures cannot produce successful partial login',async()=>{
  await mount();permError={code:'PGRST003'};assert.match((await login()).error,/temporarily unavailable/);assert.equal(ctx.profile,null);
});
test('background service errors preserve loaded profile and permissions',async()=>{
  await mount();await login();const previous=ctx.profile;profileError={code:'PGRST003'};
  await act(async()=>ctx.refreshProfile());assert.equal(ctx.profile,previous);assert.deepEqual(ctx.permissions,['view_acquisitions']);
});
test('disabled account is signed out and cannot load permissions',async()=>{
  await mount();disabled=true;assert.match((await login()).error,/disabled/);
  assert.equal(ctx.user,null);assert.equal(ctx.profile,null);assert.deepEqual(ctx.permissions,[]);assert.deepEqual(calls,[]);
});
test('response after sign-out cannot restore profile',async()=>{
  await mount();await login();let release;gate=new Promise(r=>{release=r;});
  await act(async()=>{const pending=ctx.refreshProfile();await ctx.signOut();release();await pending;await new Promise(r=>setTimeout(r,5));});
  assert.equal(ctx.user,null);assert.equal(ctx.profile,null);assert.deepEqual(ctx.permissions,[]);
});
