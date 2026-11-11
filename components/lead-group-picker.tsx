'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function LeadGroupPicker({ companyId, value, onChange }: { companyId: string; value: string; onChange: (value: string) => void }) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase.from('lead_groups').select('id,name').eq('company_id', companyId).order('name').then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message); else setGroups(data ?? []);
    });
    return () => { active = false; };
  }, [companyId]);
  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    const { data, error } = await supabase.from('lead_groups').insert({ company_id: companyId, name: name.trim() }).select('id,name').single();
    setSaving(false);
    if (error) { setError(error.message); return; }
    setGroups((old) => [...old, data]); onChange(data.id); setName('');
  };
  return <div className="space-y-2">
    <Label>Lead group</Label>
    <select aria-label="Lead group" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select>
    <div className="flex gap-2"><Input aria-label="New group name" maxLength={120} placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} /><Button type="button" variant="outline" disabled={saving || !name.trim()} onClick={create}>Create group</Button></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
