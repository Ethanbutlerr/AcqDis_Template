const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const fixture=JSON.parse(fs.readFileSync(new URL('./permission-test-fixtures.json', import.meta.url),'utf8'));
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.user_id',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.role',true) $$;
CREATE FUNCTION public.get_current_company_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE TABLE permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE,name text,description text,category text);
CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,name text,description text);
CREATE TABLE user_roles(user_id uuid,role_id uuid);
CREATE TABLE role_permissions(role_id uuid REFERENCES roles(id),permission_id uuid REFERENCES permissions(id),PRIMARY KEY(role_id,permission_id));
CREATE FUNCTION public.has_permission(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE acquisition_pipeline_stages(id uuid,company_id uuid,stage_key text,is_system boolean,name text,color text,sort_order int,updated_at timestamptz);
CREATE TABLE disposition_pipeline_stages(LIKE acquisition_pipeline_stages); ALTER TABLE disposition_pipeline_stages ADD position int;
CREATE TABLE lead_pipeline_stages(LIKE acquisition_pipeline_stages);
CREATE TABLE management_pipeline_stages(LIKE acquisition_pipeline_stages);
CREATE TABLE pipeline_stage_mappings(company_id uuid);
`);
for(const table of ['contacts','acquisition_records','disposition_records','management_records','opportunities','properties','tasks','lead_records']) await db.exec(`CREATE TABLE ${table}(id uuid DEFAULT gen_random_uuid(),deleted_at timestamptz,archived_at timestamptz);`);
for(const p of fixture.policies) await db.exec(`CREATE POLICY "${p.policyname}" ON ${p.tablename} FOR ${p.cmd}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`);
for(const p of fixture.catalog) {
 await db.query('INSERT INTO permissions(key,name,description,category) VALUES($1,$2,$3,$4)',[p.key,p.name,p.description,p.category]);
 await db.query(`WITH r AS (INSERT INTO roles(company_id,name) VALUES(public.get_current_company_id(),$1) RETURNING id) INSERT INTO role_permissions SELECT r.id,p.id FROM r,permissions p WHERE p.key=$1`,[p.key]);
}
for(const f of fixture.functions) await db.exec(f.definition);
await db.exec(fs.readFileSync(new URL('../../supabase/migrations/20260916172640_permission_catalog_cleanup.sql', import.meta.url),'utf8'));
const user='00000000-0000-0000-0000-000000000002';
await db.query("select set_config('request.user_id',$1,false)",[user]);
async function role(name){await db.exec('DELETE FROM user_roles');await db.query('INSERT INTO user_roles SELECT $1,id FROM roles WHERE name=$2',[user,name]);}
async function has(key){return (await db.query('select has_permission($1) result',[key])).rows[0].result;}
async function rejects(sql,pattern){await assert.rejects(()=>db.exec(sql),pattern);}
await role('edit_acquisition_records');assert.equal(await has('edit_acquisitions'),true);
await role('edit_acquisitions');assert.equal(await has('edit_acquisition_records'),true);assert.equal(await has('manage_pipeline_stages'),true);
await role('view_calls');assert.equal(await has('make_calls'),true);assert.equal(await has('receive_calls'),true);
await role('view_acquisitions');assert.equal(await has('make_calls'),true);assert.equal(await has('receive_calls'),false);
await rejects("select save_pipeline_stage_layout('acquisition','[]')",/permission to configure/);
await db.exec('INSERT INTO contacts DEFAULT VALUES');
await rejects('DELETE FROM contacts',/Delete or Archive/);
await rejects('UPDATE contacts SET deleted_at=now()',/Delete or Archive/);
await role('edit_contacts');await db.exec('UPDATE contacts SET deleted_at=now()');await db.exec('UPDATE contacts SET deleted_at=null');
await role('manage_roles');
const roleId=(await db.query("select id from roles where name='edit_acquisitions'")).rows[0].id;
const countBefore=(await db.query('select count(*) count from role_permissions where role_id=$1',[roleId])).rows[0].count;
await assert.rejects(()=>db.query('select save_role_permissions($1,$2,null,$3)',[roleId,'No change',['00000000-0000-0000-0000-000000000099']]),/Unknown permission/);
assert.equal((await db.query('select count(*) count from role_permissions where role_id=$1',[roleId])).rows[0].count,countBefore);
const editId=(await db.query("select id from permissions where key='edit_acquisitions'")).rows[0].id;
await db.query('select save_role_permissions($1,$2,null,$3)',[roleId,'edit_acquisitions',[editId]]);
await role('edit_acquisitions');assert.equal(await has('manage_pipeline_stages'),false);assert.equal(await has('edit_acquisitions'),true);
await rejects("select save_pipeline_stage_layout('acquisition','[]')",/permission to configure/);
await rejects('select save_role_permissions(null,\'Blocked\',null,ARRAY[]::uuid[])',/Manage Roles/);
await role('view_calls');
await db.exec("DELETE FROM role_permissions WHERE role_id IN (select role_id from user_roles) AND permission_id=(select id from permissions where key='make_calls')");
assert.equal(await has('view_calls'),true);assert.equal(await has('make_calls'),false);assert.equal(await has('receive_calls'),true);
console.log('PASS: migration executes; aliases preserve access; calls are independent; stage configuration is separate; deletion is gated; invalid role saves preserve grants; unauthorized role saves denied.');
await db.close();
