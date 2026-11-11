// Isolated PostgreSQL execution; never connects to the linked Supabase project.
// Install test engine separately: npm install --prefix .crm-test-tools --no-save --package-lock=false @electric-sql/pglite
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../../.crm-test-tools/node_modules/@electric-sql/pglite');
const root = path.join(__dirname,'../..');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('CRM migration and actual SQL workflows in isolated PostgreSQL', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.user',true),'')::uuid $$;
      CREATE FUNCTION public.get_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.company',true),'')::uuid $$;
      CREATE FUNCTION public.has_permission(p text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.permissions',true),'') = 'all' OR p = ANY(string_to_array(COALESCE(current_setting('test.permissions',true),''),',')) $$;`);
    await db.exec(fs.readFileSync(path.join(__dirname,'crm-schema-fixture.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'crm-policy-fixture.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261111042300_crm_reliability.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261111133836_acquisition_board_all_leads.sql'),'utf8'));
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
      SELECT set_config('test.user','${id(2)}',false),set_config('test.company','${id(1)}',false),set_config('test.permissions','all',false);
      INSERT INTO companies(id,name) VALUES ('${id(1)}','Test Company'),('${id(9)}','Other Company');
      INSERT INTO profiles(id,company_id,full_name,is_disabled) VALUES ('${id(2)}','${id(1)}','Manager A',false),('${id(3)}','${id(1)}','Manager B',false),('${id(8)}','${id(9)}','Foreign manager',false);
      INSERT INTO acquisition_pipeline_stages(id,company_id,name,stage_key) VALUES ('${id(4)}','${id(1)}','New Lead','new_lead'),('${id(5)}','${id(1)}','Contract Executed','contract_executed');
      INSERT INTO disposition_pipeline_stages(id,company_id,name,stage_key) VALUES ('${id(6)}','${id(1)}','New Lead','new_lead');
      INSERT INTO scoreboard_members(company_id,user_id,is_included) VALUES ('${id(1)}','${id(2)}',true),('${id(1)}','${id(3)}',true);`);
    const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
    const create = async (street, request, details={}) => (await query('select create_acquisition_opportunity($1,$2,$3,$4,$5) as result',[id(4), {first_name:'Ada',phone:'(212) 555-0100',email:'ada@example.com',mailing_city:'Boston'}, {street_address:street,city:'Austin',state:'TX',zip_code:'78701',bedrooms:3,asking_price:120000}, details,request]))[0].result;
    let lead, groupA, groupB;
    await t.test('manual creation is atomic, grouped, preserves fields, and is retry-safe',async()=>{
      await db.exec('SET ROLE authenticated');
      groupA=(await query('insert into lead_groups(company_id,name) values ($1,$2) returning id',[id(1),'Group A']))[0].id;
      groupB=(await query('insert into lead_groups(company_id,name) values ($1,$2) returning id',[id(1),'Group B']))[0].id;
      lead=await create('10 Main St',id(20),{group_id:groupA,metadata:{custom:'keep me'}});
      assert.equal(lead.record.group_id,groupA);
      assert.equal((await create('10 Main St',id(20))).record.id,lead.record.id);
      assert.equal((await query('select count(*)::int n from acquisition_records'))[0].n,1);
      assert.equal((await query('select city,bedrooms from properties where id=$1',[lead.record.property_id]))[0].bedrooms,3);
      assert.equal((await query('select mailing_city from contacts where id=$1',[lead.record.contact_id]))[0].mailing_city,'Boston');
    });
    await t.test('same normalized seller + property rejected; separate property allowed',async()=>{
      await assert.rejects(()=>create('10 Main St',id(21)),/Duplicate lead/);
      const other=await create('12 Main St',id(22));
      assert.notEqual(other.record.id,lead.record.id);
    });
    await t.test('CSV batch attaches to same model and retains original custom fields',async()=>{
      const batch=(await query('insert into acquisition_import_batches(company_id,name,file_name,total_rows) values ($1,$2,$3,1) returning id',[id(1),'October','October.csv']))[0].id;
      const imported=await create('14 Main St',id(23),{group_id:groupA,import_batch_id:batch,metadata:{csv_original:{custom:'important'}}});
      assert.equal(imported.record.import_batch_id,batch);
      assert.equal(imported.record.metadata.csv_original.custom,'important');
      assert.ok(imported.record.opportunity_id);
    });
    await t.test('group, assignment, tags persist and filters combine',async()=>{
      await query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id],'group',groupB]);
      await query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id],'assign',id(3)]);
      await query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id],'tag','priority']);
      const found=(await query('select search_acquisition_leads($1) result',[{group:groupB,assigned:id(3),tag:'priority',search:'Main'}]))[0].result;
      assert.equal(found.total,1); assert.equal(found.records[0].id,lead.record.id);
      assert.equal((await query('select assigned_acquisition_user_id from opportunities where id=$1',[lead.record.opportunity_id]))[0].assigned_acquisition_user_id,id(3));
      await assert.rejects(()=>query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id,id(999)],'group',groupA]),/No changes were saved/);
      assert.equal((await query('select group_id from acquisition_records where id=$1',[lead.record.id]))[0].group_id,groupB);
    });
    await t.test('unauthorized and cross-company changes rejected without partial saves',async()=>{
      await assert.rejects(()=>query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id],'assign',id(8)]),/Invalid manager/);
      await query("select set_config('test.permissions','view_acquisitions',false)");
      await assert.rejects(()=>create('Permission denied',id(25)),/permission/);
      await assert.rejects(()=>query('select bulk_edit_acquisition_leads($1,$2,$3)',[[lead.record.id],'tag','bad']),/Permission denied/);
      assert.equal((await query('select search_acquisition_leads($1) result',[{assigned:id(3)}]))[0].result.total,0);
      await query("select set_config('test.permissions','all',false)");
    });
    await t.test('historical contracts, verified revenue, closings and personal earnings remain distinct',async()=>{
      await db.exec('RESET ROLE');
      await query("update acquisition_records set contract_executed_at='2020-01-10',contract_executed_by=$1 where id=$2",[id(2),lead.record.id]);
      let all=(await query("select get_scoreboard_data('all',$1) result",[id(1)]))[0].result;
      assert.equal(all.managers.find(m=>m.user_id===id(2)).signed_contracts,1);
      let week=(await query("select get_scoreboard_data('week',$1) result",[id(1)]))[0].result;
      assert.equal(week.managers.find(m=>m.user_id===id(2)).signed_contracts,0);
      await query("insert into disposition_records(id,company_id,acquisition_record_id,status,actual_revenue,revenue_verification_status,closing_date,assigned_user_id) values ($1,$2,$3,'closed',10000,'pending',current_date,$4)",[id(30),id(1),lead.record.id,id(3)]);
      all=(await query("select get_scoreboard_data('all',$1) result",[id(1)]))[0].result;
      assert.equal(all.managers.find(m=>m.user_id===id(2)).closed_deals,1);
      assert.equal(all.managers.find(m=>m.user_id===id(2)).verified_revenue,0);
      await query("update disposition_records set revenue_verification_status='verified' where id=$1",[id(30)]);
      await query("insert into revenue_attributions(company_id,disposition_record_id,user_id,company_revenue,personal_earnings,locked_at) values ($1,$2,$3,10000,1000,now()),($1,$2,$4,10000,2000,now())",[id(1),id(30),id(2),id(3)]);
      const kpi=(await query('select get_dashboard_kpis($1) result',[id(1)]))[0].result;
      assert.equal(kpi.company_revenue,10000); assert.equal(kpi.personal_earnings,1000); assert.equal(kpi.closings,1);
      all=(await query("select get_scoreboard_data('all',$1) result",[id(1)]))[0].result;
      assert.equal(all.managers.find(m=>m.user_id===id(2)).verified_revenue,10000);
      assert.equal(all.managers.find(m=>m.user_id===id(3)).verified_revenue,0);
    });
    await t.test('board returns all matching leads and filters before limiting thousands of rows',async()=>{
      await db.exec('RESET ROLE');
      await query("insert into acquisition_records(company_id,pipeline_stage_id,group_id,lead_source,motivation,created_at) select $1,$2,$3,'Pagination fixture','row '||n,now()-(n||' hours')::interval from generate_series(1,3641) n",[id(1),id(4),groupA]);
      await db.exec('SET ROLE authenticated');
      const page1=(await query('select search_acquisition_leads($1,0) result',[{group:groupA,source:'Pagination fixture'}]))[0].result;
      const page2=(await query('select search_acquisition_leads($1,1) result',[{group:groupA,source:'Pagination fixture'}]))[0].result;
      assert.equal(page1.total,3641);assert.equal(page1.records.length,3641);assert.equal(page2.records.length,0);
      assert.equal(page2.records.some(r=>page1.records.some(first=>first.id===r.id)),false);
    });
    await t.test('dials use actual outbound calls, exclude simulations, and attribute users',async()=>{
      await db.exec('RESET ROLE');
      await query("insert into calls(company_id,assigned_user_id,direction,is_simulated,call_sid,started_at) values ($1,$2,'outbound',false,'real-1',now()),($1,$2,'outbound',true,'simulated',now()),($1,$2,'inbound',false,'inbound',now()),($1,$3,'outbound',false,'real-2',now()),($1,$2,'outbound',false,'old','2000-01-01')",[id(1),id(2),id(3)]);
      const board=(await query("select get_scoreboard_data('week',$1) result",[id(1)]))[0].result;
      const a=board.managers.find(m=>m.user_id===id(2));assert.equal(a.dials_today,1);assert.equal(a.dials_week,1);assert.equal(a.dials_period,1);
      assert.equal(board.managers.find(m=>m.user_id===id(3)).dials_period,1);
    });
    await t.test('notification event retries preserve read status and user isolation',async()=>{
      await query("insert into notifications(company_id,user_id,type,title,event_key) values ($1,$2,'missed_call','Call','call:1')",[id(1),id(2)]);
      await db.exec('SET ROLE authenticated');
      await query('update notifications set is_read=true,read_at=now() where user_id=$1',[id(2)]);
      await db.exec('RESET ROLE');
      await query("insert into notifications(company_id,user_id,type,title,event_key) values ($1,$2,'missed_call','Call','call:1') on conflict(company_id,user_id,event_key) do nothing",[id(1),id(2)]);
      await db.exec('SET ROLE authenticated');
      const notifications=await query('select is_read from notifications'); assert.equal(notifications.length,1); assert.equal(notifications[0].is_read,true);
      await query("select set_config('test.user',$1,false)",[id(3)]);
      assert.equal((await query('select * from notifications')).length,0);
      assert.equal((await query('update notifications set is_read=false returning id')).length,0);
    });
  } finally { await db.close(); }
});
