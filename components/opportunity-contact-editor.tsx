'use client';

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { usePermissions } from '@/lib/auth/use-permissions';
import { normalizeEmail, normalizePhone } from '@/lib/utils/format';
import type { Contact } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function OpportunityContactEditor({ contact, companyId, onSaved }: {
  contact: Contact;
  companyId: string;
  onSaved: (contact: Contact) => void;
}) {
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const initial = () => ({ first_name: contact.first_name ?? '', last_name: contact.last_name ?? '', primary_phone: contact.primary_phone ?? '', primary_email: contact.primary_email ?? '' });
  const [draft, setDraft] = useState(initial);
  const [original, setOriginal] = useState(initial);

  if (!hasPermission('edit_contacts')) return null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !hasPermission('edit_contacts')) return;
    const changes: Record<string, string | null> = {};
    for (const key of Object.keys(draft) as (keyof typeof draft)[]) {
      if (draft[key].trim() !== original[key].trim()) changes[key] = draft[key].trim() || null;
    }
    if ('primary_phone' in changes) {
      const normalized = changes.primary_phone ? normalizePhone(changes.primary_phone) : null;
      if (normalized && !/^\d{7,15}$/.test(normalized)) {
        setError('Enter a valid phone number, including the country code for international numbers.');
        return;
      }
      changes.primary_phone_normalized = normalized;
    }
    if ('primary_email' in changes) changes.primary_email_normalized = changes.primary_email ? normalizeEmail(changes.primary_email) : null;
    if (!Object.keys(changes).length) { setOpen(false); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const { data, error: saveError } = await supabase.from('contacts').update(changes)
        .eq('id', contact.id).eq('company_id', companyId).select('*').single();
      if (saveError || !data) throw new Error('Contact could not be saved. Check your connection and editing permissions, then retry.');
      onSaved(data as Contact);
      setSaved(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contact could not be saved. Please retry.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {saved && <span role="status" className="text-xs text-muted-foreground">Contact saved</span>}
        <Button size="sm" variant="outline" onClick={() => { setDraft(initial()); setOriginal(initial()); setError(''); setSaved(false); setOpen(true); }}>Edit contact</Button>
      </div>
      <Dialog open={open} onOpenChange={(value) => { if (!savingRef.current) setOpen(value); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
            <DialogDescription>Changes apply everywhere this contact is linked. Save the phone number before calling.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['first_name', 'First name', 'text'], ['last_name', 'Last name', 'text'],
                ['primary_phone', 'Phone', 'tel'], ['primary_email', 'Email', 'email'],
              ] as const).map(([field, label, type]) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`contact-edit-${field}`}>{label}</Label>
                  <Input id={`contact-edit-${field}`} type={type} value={draft[field]} disabled={saving}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
                </div>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save contact'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
