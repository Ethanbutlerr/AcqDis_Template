'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollText, Plus, Eye, Trash2, Edit, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import type { AppChangelogEntry } from '@/lib/types';

export default function ChangelogPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [entries, setEntries] = useState<AppChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    version: '', summary: '', added: '', changed: '', fixed: '', security: '',
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase.from('app_changelog').select('*').eq('company_id', companyId).order('release_date', { ascending: false });
    setEntries((data ?? []) as AppChangelogEntry[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm({ version: '', summary: '', added: '', changed: '', fixed: '', security: '' });
    setEditingId(null);
    setShowEditor(true);
  };

  const openEdit = (entry: AppChangelogEntry) => {
    setForm({
      version: entry.version, summary: entry.summary,
      added: entry.added.join('\n'), changed: entry.changed.join('\n'),
      fixed: entry.fixed.join('\n'), security: entry.security.join('\n'),
    });
    setEditingId(entry.id);
    setShowEditor(true);
  };

  const save = async () => {
    if (!companyId || !form.version || !form.summary) return;
    const payload = {
      company_id: companyId,
      version: form.version,
      summary: form.summary,
      added: form.added.split('\n').filter(Boolean),
      changed: form.changed.split('\n').filter(Boolean),
      fixed: form.fixed.split('\n').filter(Boolean),
      security: form.security.split('\n').filter(Boolean),
      author: profile?.full_name ?? 'Unknown',
    };
    if (editingId) {
      await supabase.from('app_changelog').update(payload).eq('id', editingId);
    } else {
      await supabase.from('app_changelog').insert({ ...payload, status: 'draft' });
    }
    setShowEditor(false);
    load();
  };

  const publish = async (id: string) => {
    await supabase.from('app_changelog').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id);
    load();
  };

  const unpublish = async (id: string) => {
    await supabase.from('app_changelog').update({ status: 'draft', published_at: null }).eq('id', id);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from('app_changelog').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Changelog</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Product release notes and version history.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> New Release
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}</div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No changelog entries yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id} className={entry.status === 'draft' ? 'border-dashed' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">v{entry.version}</CardTitle>
                    <Badge variant={entry.status === 'published' ? 'default' : 'secondary'} className="text-[10px] capitalize">
                      {entry.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{format(new Date(entry.release_date), 'MMM d, yyyy')}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(entry)}><Edit className="h-3.5 w-3.5" /></Button>
                    {entry.status === 'draft' ? (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-600" onClick={() => publish(entry.id)}><CheckCircle2 className="h-3.5 w-3.5" /></Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => unpublish(entry.id)}><Eye className="h-3.5 w-3.5" /></Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => remove(entry.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{entry.summary}</p>
                {entry.added.length > 0 && <div><p className="text-xs font-medium text-emerald-600 mb-1">Added</p><ul className="space-y-0.5">{entry.added.map((a, i) => <li key={i} className="text-xs text-muted-foreground">• {a}</li>)}</ul></div>}
                {entry.changed.length > 0 && <div><p className="text-xs font-medium text-blue-600 mb-1">Changed</p><ul className="space-y-0.5">{entry.changed.map((a, i) => <li key={i} className="text-xs text-muted-foreground">• {a}</li>)}</ul></div>}
                {entry.fixed.length > 0 && <div><p className="text-xs font-medium text-amber-600 mb-1">Fixed</p><ul className="space-y-0.5">{entry.fixed.map((a, i) => <li key={i} className="text-xs text-muted-foreground">• {a}</li>)}</ul></div>}
                {entry.security.length > 0 && <div><p className="text-xs font-medium text-red-600 mb-1">Security</p><ul className="space-y-0.5">{entry.security.map((a, i) => <li key={i} className="text-xs text-muted-foreground">• {a}</li>)}</ul></div>}
                <p className="text-[10px] text-muted-foreground">by {entry.author ?? 'Unknown'}{entry.deployment_source ? ` · ${entry.deployment_source}` : ''}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Release' : 'New Release'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Version</Label><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.1.0" /></div>
            <div><Label>Summary</Label><Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Brief description of this release" rows={2} /></div>
            <div><Label>Added (one per line)</Label><Textarea value={form.added} onChange={(e) => setForm({ ...form, added: e.target.value })} rows={3} /></div>
            <div><Label>Changed (one per line)</Label><Textarea value={form.changed} onChange={(e) => setForm({ ...form, changed: e.target.value })} rows={2} /></div>
            <div><Label>Fixed (one per line)</Label><Textarea value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} rows={2} /></div>
            <div><Label>Security / Infrastructure (one per line)</Label><Textarea value={form.security} onChange={(e) => setForm({ ...form, security: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={save}>Save as Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
