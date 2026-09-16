const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../supabase/functions/voice-token/index.ts'),'utf8').replace(/^import .*;\r?$/gm,'');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function run(keys,admin=false){
 let handler,grant;
 const supabase={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from(table){
  const filters={};let single=false;
  const q={select(){return q},eq(k,v){filters[k]=v;return q},in(k,v){filters[k]=v;return q},limit(){return q},maybeSingle(){single=true;return q},then(resolve,reject){
   let data=[];
   if(table==='profiles')data=[{id:'user',company_id:'company',is_disabled:false,is_agency_admin:admin}];
   if(table==='user_roles')data=[{role_id:'role'}];
   if(table==='roles')data=[{id:'role'}];
   if(table==='permissions')data=(Array.isArray(filters.key)?filters.key:[filters.key]).map(key=>({id:key}));
   if(table==='role_permissions')data=keys.filter(k=>(filters.permission_id||[]).includes(k)).map(k=>({role_id:'role',permission_id:k}));
   if(table==='company_credentials')data=['account_sid','auth_token','twiml_app_sid','api_key_sid','api_key_secret'].map(k=>({credential_key:k,credential_value:'fixture-'+k}));
   return Promise.resolve({data:single?(data[0]||null):data,error:null}).then(resolve,reject);
  }};return q;
 }};
 class AccessToken {static VoiceGrant=class{constructor(g){Object.assign(this,g);grant=g}};addGrant(){}toJwt(){return 'test-token'}}
 vm.runInNewContext(code,{Deno:{env:{get:()=> 'https://example.supabase.co'},serve:h=>handler=h},createClient:()=>supabase,twilio:{jwt:{AccessToken}},Request,Response,URL,console,Set,Map});
 const response=await handler(new Request('https://example.supabase.co/functions/v1/voice-token',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({action:'get_token',company_id:'company'})}));
 return {status:response.status,grant};
}
(async()=>{
 assert.equal((await run(['view_calls'])).status,403);
 assert.equal((await run(['view_acquisitions'])).status,403);
 let r=await run(['make_calls']);assert.equal(r.status,200);assert.equal(r.grant.incomingAllow,false);assert.ok(r.grant.outgoingApplicationSid);
 r=await run(['receive_calls']);assert.equal(r.status,200);assert.equal(r.grant.incomingAllow,true);assert.equal(r.grant.outgoingApplicationSid,undefined);
 r=await run(['make_calls','receive_calls']);assert.equal(r.status,200);assert.equal(r.grant.incomingAllow,true);assert.ok(r.grant.outgoingApplicationSid);
 assert.equal((await run([],true)).status,200);
 console.log('PASS: voice-token denies view-only access, issues direction-specific grants, and retains agency-admin calling. No calls placed.');
})().catch(e=>{console.error(e);process.exitCode=1});
