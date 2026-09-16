const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../supabase/functions/communication-provider/index.ts'),'utf8').replace(/^import .*;\r?$/gm,'');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function run(profile,auth=true){
 let handler;
 const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:profile})};
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from:()=>q};
 vm.runInNewContext(code,{Deno:{env:{get:()=>''},serve:h=>handler=h},createClient:()=>client,Response,console});
 return (await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({action:'simulate_probe',company_id:'company'})}))).status;
}
(async()=>{
 assert.equal(await run(null,false),401);
 assert.equal(await run({company_id:'company',is_agency_admin:false}),403);
 assert.equal(await run({company_id:'other',is_agency_admin:true}),403);
 assert.equal(await run({company_id:'company',is_agency_admin:true,is_disabled:true}),403);
 assert.equal(await run({company_id:'company',is_agency_admin:true}),400); // Passed auth; unknown probe action performs no mutation.
 console.log('PASS: simulation actions reject missing auth, ordinary users, disabled admins, and other-company admins.');
})().catch(e=>{console.error(e);process.exitCode=1});
