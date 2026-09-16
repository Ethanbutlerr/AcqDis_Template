'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { normalizePhone, formatPhone, normalizeEmail, formatDate } from '@/lib/utils/format';
import { toCSV, parseCSV, CSV_CONTACT_COLUMNS } from '@/lib/utils/csv';
import { logActivity } from '@/lib/utils/activity';
import { Contact, ContactType, Tag, ContactPhone, ContactEmail, Property, Opportunity } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContactDrawer } from '@/components/contact-drawer';
import { NotesSection } from '@/components/notes-section';
import { FilesSection } from '@/components/files-section';
import { ActivityTimeline } from '@/components/activity-timeline';
import { CustomFieldsSection } from '@/components/custom-fields-section';
import {
  Search, Plus, Upload, Download, ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, Mail, MessageSquare, MoreHorizontal, Copy, GitMerge, X,
  Users, Tag as TagIcon, ArrowUpDown, FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SortField = 'first_name' | 'last_name' | 'company_name' | 'primary_phone' | 'primary_email' | 'mailing_city' | 'mailing_state' | 'created_at' | 'last_contacted_at';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

export default function ContactsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('edit_contacts');
  const canExport = hasPermission('export_contacts');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactTypes, setContactTypes] = useState<ContactType[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<Contact[][]>([]);

  const companyId = profile?.company_id;

  const loadContacts = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId);

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,company_name.ilike.%${search}%,primary_email.ilike.%${search}%,primary_phone.ilike.%${search}%`);
    }

    query = query.order(sortField, { ascending: sortDir === 'asc' });
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count } = await query;
    setContacts((data ?? []) as Contact[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [companyId, search, sortField, sortDir, page]);

  const loadMetadata = useCallback(async () => {
    if (!companyId) return;
    const [typesRes, tagsRes] = await Promise.all([
      supabase.from('contact_types').select('*').eq('company_id', companyId).order('name'),
      supabase.from('tags').select('*').eq('company_id', companyId).order('name'),
    ]);
    setContactTypes((typesRes.data ?? []) as ContactType[]);
    setTags((tagsRes.data ?? []) as Tag[]);
  }, [companyId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const handleBulkTag = async (tagId: string) => {
    if (!companyId) return;
    const inserts = Array.from(selectedIds).map((contact_id) => ({ contact_id, tag_id: tagId }));
    await supabase.from('contact_tags').upsert(inserts, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
    setSelectedIds(new Set());
  };

  const handleBulkAssign = async (userId: string | null) => {
    if (!companyId) return;
    await supabase.from('contacts').update({ assigned_user_id: userId }).in('id', Array.from(selectedIds));
    setSelectedIds(new Set());
    loadContacts();
  };

  const handleExport = () => {
    const rows = contacts.map((c) => ({
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      company_name: c.company_name ?? '',
      primary_phone: c.primary_phone ?? '',
      primary_email: c.primary_email ?? '',
      mailing_address_1: c.mailing_address_1 ?? '',
      mailing_address_2: c.mailing_address_2 ?? '',
      mailing_city: c.mailing_city ?? '',
      mailing_state: c.mailing_state ?? '',
      mailing_zip: c.mailing_zip ?? '',
      lead_source: c.lead_source ?? '',
    }));
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const detectDuplicates = async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('primary_phone_normalized');

    const allContacts = (data ?? []) as Contact[];
    const groups: Contact[][] = [];
    const seen = new Set<string>();

    for (const contact of allContacts) {
      if (seen.has(contact.id)) continue;
      const matches = allContacts.filter((c) => {
        if (c.id === contact.id || seen.has(c.id)) return false;
        if (contact.primary_phone_normalized && c.primary_phone_normalized === contact.primary_phone_normalized) return true;
        if (contact.primary_email_normalized && c.primary_email_normalized === contact.primary_email_normalized) return true;
        return false;
      });
      if (matches.length > 0) {
        const group = [contact, ...matches];
        group.forEach((c) => seen.add(c.id));
        groups.push(group);
      }
    }
    setDuplicateGroups(groups);
    setShowMerge(true);
  };

  const mergeContacts = async (group: Contact[]) => {
    if (!companyId || group.length < 2 || !hasPermission('delete_records')) return;
    const primary = group[0];
    const duplicates = group.slice(1);

    for (const dup of duplicates) {
      await supabase.from('contact_phones').update({ contact_id: primary.id }).eq('contact_id', dup.id);
      await supabase.from('contact_emails').update({ contact_id: primary.id }).eq('contact_id', dup.id);
      await supabase.from('contact_contact_types').upsert(
        (await supabase.from('contact_contact_types').select('contact_type_id').eq('contact_id', dup.id)).data?.map((r: { contact_type_id: string }) => ({ contact_id: primary.id, contact_type_id: r.contact_type_id })) ?? [],
        { onConflict: 'contact_id,contact_type_id', ignoreDuplicates: true }
      );
      await supabase.from('contact_tags').upsert(
        (await supabase.from('contact_tags').select('tag_id').eq('contact_id', dup.id)).data?.map((r: { tag_id: string }) => ({ contact_id: primary.id, tag_id: r.tag_id })) ?? [],
        { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
      );
      await supabase.from('notes').update({ entity_id: primary.id }).eq('entity_type', 'contact').eq('entity_id', dup.id);
      await supabase.from('files').update({ entity_id: primary.id }).eq('entity_type', 'contact').eq('entity_id', dup.id);
      await supabase.from('activity_events').update({ entity_id: primary.id }).eq('entity_type', 'contact').eq('entity_id', dup.id);
      await supabase.from('opportunities').update({ primary_seller_contact_id: primary.id }).eq('primary_seller_contact_id', dup.id);
      await supabase.from('tasks').update({ related_contact_id: primary.id }).eq('related_contact_id', dup.id);
      await supabase.from('contacts').delete().eq('id', dup.id);
    }

    await logActivity({ companyId, actorId: profile?.id, entityType: 'contact', entityId: primary.id, eventType: 'contact_merged', metadata: { merged_count: duplicates.length } });
    setDuplicateGroups((prev) => prev.filter((g) => g[0].id !== primary.id));
    loadContacts();
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortField === field ? (
        sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );

  return (
    <div className="space-y-4 p-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount} total contacts
          </p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowImport(true)}>
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={!hasPermission('delete_records')} onClick={detectDuplicates}>
                <GitMerge className="h-4 w-4" />
                <span className="hidden sm:inline">Duplicates</span>
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Contact</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search contacts..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {contactTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTag} onValueChange={setFilterTag}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-accent/50 px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex-1" />
          {canEdit && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8">
                    <TagIcon className="h-3.5 w-3.5" /> Tag
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Add tag</DropdownMenuLabel>
                  {tags.map((t) => (
                    <DropdownMenuItem key={t.id} onClick={() => handleBulkTag(t.id)}>
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => handleBulkAssign(null)}>
                <X className="h-3.5 w-3.5" /> Unassign
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Spreadsheet table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    checked={selectedIds.size === contacts.length && contacts.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="first_name" label="First Name" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="last_name" label="Last Name" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="company_name" label="Company" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="primary_phone" label="Phone" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="primary_email" label="Email" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="mailing_city" label="City" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="mailing_state" label="State" /></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Types</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Tags</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground"><SortHeader field="created_at" label="Created" /></th>
                <th className="w-20 px-3 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-12 text-muted-foreground">No contacts found.</td></tr>
              ) : (
                contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className={cn(
                      'border-b hover:bg-accent/30 transition-colors cursor-pointer',
                      selectedIds.has(contact.id) && 'bg-primary/5'
                    )}
                    onClick={() => setDrawerContactId(contact.id)}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => toggleSelect(contact.id)}
                      />
                    </td>
                    <td className="px-3 py-2">{contact.first_name ?? '—'}</td>
                    <td className="px-3 py-2">{contact.last_name ?? '—'}</td>
                    <td className="px-3 py-2">{contact.company_name ?? '—'}</td>
                    <td className="px-3 py-2">{contact.primary_phone ? formatPhone(contact.primary_phone) : '—'}</td>
                    <td className="px-3 py-2 truncate max-w-[180px]">{contact.primary_email ?? '—'}</td>
                    <td className="px-3 py-2">{contact.mailing_city ?? '—'}</td>
                    <td className="px-3 py-2">{contact.mailing_state ?? '—'}</td>
                    <td className="px-3 py-2"><ContactTypeBadges contactId={contact.id} /></td>
                    <td className="px-3 py-2"><ContactTagBadges contactId={contact.id} tags={tags} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(contact.created_at)}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {contact.primary_phone && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Call" onClick={() => router.push(`/conversations?contact_id=${contact.id}&action=call`)}>
                            <Phone className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {contact.primary_phone && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="SMS" onClick={() => router.push(`/conversations?contact_id=${contact.id}`)}>
                            <MessageSquare className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {contact.primary_email && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Email" asChild>
                            <a href={`mailto:${contact.primary_email}`}><Mail className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Contact Drawer */}
      {drawerContactId && companyId && (
        <ContactDrawer
          contactId={drawerContactId}
          companyId={companyId}
          contactTypes={contactTypes}
          tags={tags}
          onClose={() => setDrawerContactId(null)}
          onUpdated={loadContacts}
        />
      )}

      {/* Create Contact Dialog */}
      {showCreate && companyId && (
        <CreateContactDialog
          companyId={companyId}
          contactTypes={contactTypes}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); setDrawerContactId(id); loadContacts(); }}
        />
      )}

      {/* CSV Import Dialog */}
      {showImport && companyId && (
        <ImportContactsDialog
          companyId={companyId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadContacts(); }}
        />
      )}

      {/* Merge Duplicates Dialog */}
      {showMerge && (
        <MergeDuplicatesDialog
          groups={duplicateGroups}
          onClose={() => setShowMerge(false)}
          onMerge={mergeContacts}
        />
      )}
    </div>
  );
}

function ContactTypeBadges({ contactId }: { contactId: string }) {
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    supabase
      .from('contact_contact_types')
      .select('contact_types(name)')
      .eq('contact_id', contactId)
      .then(({ data }) => {
        setTypes((data ?? []).map((r: { contact_types: { name: string }[] }) => r.contact_types?.[0]?.name ?? '').filter(Boolean));
      });
  }, [contactId]);
  if (types.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => (
        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
      ))}
    </div>
  );
}

function ContactTagBadges({ contactId, tags }: { contactId: string; tags: Tag[] }) {
  const [tagIds, setTagIds] = useState<string[]>([]);
  useEffect(() => {
    supabase
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', contactId)
      .then(({ data }) => {
        setTagIds((data ?? []).map((r: { tag_id: string }) => r.tag_id));
      });
  }, [contactId]);
  if (tagIds.length === 0) return <span className="text-muted-foreground">—</span>;
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));
  return (
    <div className="flex flex-wrap gap-1">
      {tagIds.map((id) => (
        <Badge key={id} variant="outline" className="text-xs">{tagMap.get(id) ?? id}</Badge>
      ))}
    </div>
  );
}

function CreateContactDialog({
  companyId,
  contactTypes,
  onClose,
  onCreated,
}: {
  companyId: string;
  contactTypes: ContactType[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    company_name: '',
    primary_phone: '',
    primary_email: '',
    mailing_address_1: '',
    mailing_city: '',
    mailing_state: '',
    mailing_zip: '',
    lead_source: '',
  });
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const phoneNorm = form.primary_phone ? normalizePhone(form.primary_phone) : null;
    const emailNorm = form.primary_email ? normalizeEmail(form.primary_email) : null;
    const { data, error } = await supabase.from('contacts').insert({
      company_id: companyId,
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      company_name: form.company_name || null,
      primary_phone: form.primary_phone || null,
      primary_phone_normalized: phoneNorm,
      primary_email: form.primary_email || null,
      primary_email_normalized: emailNorm,
      mailing_address_1: form.mailing_address_1 || null,
      mailing_city: form.mailing_city || null,
      mailing_state: form.mailing_state || null,
      mailing_zip: form.mailing_zip || null,
      lead_source: form.lead_source || null,
    }).select().single();

    if (!error && data) {
      if (selectedTypes.length > 0) {
        await supabase.from('contact_contact_types').insert(
          selectedTypes.map((type_id) => ({ contact_id: data.id, contact_type_id: type_id }))
        );
      }
      await logActivity({ companyId, actorId: user?.id, entityType: 'contact', entityId: data.id, eventType: 'contact_created' });
      onCreated(data.id);
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Contact</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First Name</Label>
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last Name</Label>
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Company Name</Label>
            <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Primary Phone</Label>
              <Input value={form.primary_phone} onChange={(e) => setForm({ ...form, primary_phone: e.target.value })} placeholder="(555) 123-4567" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Primary Email</Label>
              <Input type="email" value={form.primary_email} onChange={(e) => setForm({ ...form, primary_email: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mailing Address</Label>
            <Input value={form.mailing_address_1} onChange={(e) => setForm({ ...form, mailing_address_1: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">City</Label>
              <Input value={form.mailing_city} onChange={(e) => setForm({ ...form, mailing_city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">State</Label>
              <Input value={form.mailing_state} onChange={(e) => setForm({ ...form, mailing_state: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ZIP</Label>
              <Input value={form.mailing_zip} onChange={(e) => setForm({ ...form, mailing_zip: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lead Source</Label>
            <Input value={form.lead_source} onChange={(e) => setForm({ ...form, lead_source: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contact Types</Label>
            <div className="flex flex-wrap gap-2">
              {contactTypes.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={selectedTypes.includes(t.id)}
                    onCheckedChange={(checked) => {
                      setSelectedTypes((prev) =>
                        checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                      );
                    }}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || (!form.first_name && !form.last_name && !form.company_name)}>
            Create Contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportContactsDialog({
  companyId,
  onClose,
  onImported,
}: {
  companyId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<'upload' | 'map' | 'done'>('upload');
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        setCsvData(parsed);
        const headers = Object.keys(parsed[0]);
        setCsvHeaders(headers);
        const autoMap: Record<string, string> = {};
        CSV_CONTACT_COLUMNS.forEach((col) => {
          const match = headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, '').includes(col.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5)));
          if (match) autoMap[col.value] = match;
        });
        setMapping(autoMap);
        setStep('map');
      }
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    setImporting(true);
    let count = 0;
    for (const row of csvData) {
      const mapped: Record<string, string> = {};
      Object.entries(mapping).forEach(([csvField, csvCol]) => {
        if (csvCol) mapped[csvField] = row[csvCol] ?? '';
      });

      const phone = mapped.primary_phone ?? '';
      const email = mapped.primary_email ?? '';
      const { data, error } = await supabase.from('contacts').insert({
        company_id: companyId,
        first_name: mapped.first_name || null,
        last_name: mapped.last_name || null,
        company_name: mapped.company_name || null,
        primary_phone: phone || null,
        primary_phone_normalized: phone ? normalizePhone(phone) : null,
        primary_email: email || null,
        primary_email_normalized: email ? normalizeEmail(email) : null,
        mailing_address_1: mapped.mailing_address_1 || null,
        mailing_city: mapped.mailing_city || null,
        mailing_state: mapped.mailing_state || null,
        mailing_zip: mapped.mailing_zip || null,
        lead_source: mapped.lead_source || null,
      }).select().single();

      if (!error && data) {
        count++;
        await logActivity({ companyId, actorId: user?.id, entityType: 'contact', entityId: data.id, eventType: 'contact_created', metadata: { source: 'csv_import' } });
      }
    }
    setImportedCount(count);
    setStep('done');
    setImporting(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Contacts (CSV)</DialogTitle>
        </DialogHeader>
        {step === 'upload' && (
          <div className="py-6">
            <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 cursor-pointer hover:bg-accent/50 transition-colors">
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Click to select a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">First row should contain column headers</p>
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </label>
          </div>
        )}
        {step === 'map' && (
          <div className="space-y-4 py-2 max-h-[400px] overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Map your CSV columns to contact fields. {csvData.length} rows will be imported.
            </p>
            <div className="space-y-2">
              {CSV_CONTACT_COLUMNS.map((col) => (
                <div key={col.value} className="flex items-center gap-3">
                  <div className="w-40 text-sm font-medium">{col.label}</div>
                  <Select
                    value={mapping[col.value] ?? ''}
                    onValueChange={(val) => setMapping({ ...mapping, [col.value]: val })}
                  >
                    <SelectTrigger className="flex-1 h-9">
                      <SelectValue placeholder="Skip this field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Skip this field</SelectItem>
                      {csvHeaders.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}
        {step === 'done' && (
          <div className="py-8 text-center">
            <p className="text-lg font-medium">Import complete</p>
            <p className="text-sm text-muted-foreground mt-1">{importedCount} contacts imported.</p>
          </div>
        )}
        <DialogFooter>
          {step === 'map' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing ? 'Importing...' : `Import ${csvData.length} contacts`}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={onImported}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeDuplicatesDialog({
  groups,
  onClose,
  onMerge,
}: {
  groups: Contact[][];
  onClose: () => void;
  onMerge: (group: Contact[]) => void;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge Duplicate Contacts</DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No duplicates found.</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto py-2">
            <p className="text-sm text-muted-foreground">
              {groups.length} duplicate group(s) found. The first contact in each group will be kept; others will be merged into it.
            </p>
            {groups.map((group, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2">
                {group.map((c, j) => (
                  <div key={c.id} className={cn('flex items-center gap-3 text-sm', j === 0 && 'font-medium')}>
                    <div className="flex-1">
                      {c.first_name} {c.last_name} {c.company_name ? `· ${c.company_name}` : ''}
                    </div>
                    <div className="text-muted-foreground">{c.primary_phone ?? c.primary_email ?? ''}</div>
                    {j === 0 && <Badge variant="secondary" className="text-xs">Primary</Badge>}
                  </div>
                ))}
                <Button size="sm" className="w-full" onClick={() => onMerge(group)}>
                  <GitMerge className="h-3.5 w-3.5 mr-1.5" /> Merge into primary
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
