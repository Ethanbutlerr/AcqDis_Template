'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { FieldGroup, FieldDefinition } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, GripVertical, Edit2, ToggleLeft, ToggleRight } from 'lucide-react';

const FIELD_TYPES = [
  { value: 'short_text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multi_select', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'address', label: 'Address' },
  { value: 'user', label: 'User' },
  { value: 'contact', label: 'Contact' },
  { value: 'file', label: 'File' },
  { value: 'image', label: 'Image' },
  { value: 'calculated', label: 'Calculated' },
];

const RECORD_TYPES = [
  { value: 'contact', label: 'Contacts' },
  { value: 'property', label: 'Properties' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'acquisition', label: 'Acquisitions' },
  { value: 'disposition', label: 'Dispositions' },
  { value: 'management', label: 'Management' },
];

export default function CustomFieldsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('manage_custom_fields');
  const companyId = profile?.company_id;
  const [recordType, setRecordType] = useState('contact');
  const [groups, setGroups] = useState<FieldGroup[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, FieldDefinition[]>>({});
  const [loading, setLoading] = useState(true);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showFieldDialog, setShowFieldDialog] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    const [groupsRes, defsRes] = await Promise.all([
      supabase.from('field_groups').select('*').eq('company_id', companyId).eq('record_type', recordType).order('sort_order'),
      supabase.from('field_definitions').select('*').eq('company_id', companyId).eq('record_type', recordType).order('sort_order'),
    ]);
    const groupData = (groupsRes.data ?? []) as FieldGroup[];
    setGroups(groupData);
    const defMap: Record<string, FieldDefinition[]> = {};
    groupData.forEach((g) => {
      defMap[g.id] = (defsRes.data ?? []).filter((d) => d.field_group_id === g.id) as FieldDefinition[];
    });
    setDefinitions(defMap);
    setLoading(false);
  }, [companyId, recordType]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">You don't have permission to manage custom fields.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Custom Fields</h1>
          <p className="text-sm text-muted-foreground">Manage custom fields for each record type</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowGroupDialog(true)}>
          <Plus className="h-4 w-4" /> New Group
        </Button>
      </div>

      <Tabs value={recordType} onValueChange={setRecordType}>
        <TabsList className="flex-wrap">
          {RECORD_TYPES.map((rt) => (
            <TabsTrigger key={rt.value} value={rt.value}>{rt.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <p className="text-center py-12 text-muted-foreground">Loading...</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No field groups for this record type yet.</p>
          <Button className="mt-4" size="sm" onClick={() => setShowGroupDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Create first group
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setShowFieldDialog(group.id)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Field
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {(definitions[group.id] ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No fields in this group.</p>
                ) : (
                  <div className="space-y-2">
                    {(definitions[group.id] ?? []).map((def) => (
                      <FieldRow key={def.id} def={def} onChanged={load} companyId={companyId!} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showGroupDialog && companyId && (
        <CreateGroupDialog
          companyId={companyId}
          recordType={recordType}
          sortOrder={groups.length}
          onClose={() => setShowGroupDialog(false)}
          onCreated={() => { setShowGroupDialog(false); load(); }}
        />
      )}

      {showFieldDialog && companyId && (
        <CreateFieldDialog
          companyId={companyId}
          groupId={showFieldDialog}
          recordType={recordType}
          sortOrder={(definitions[showFieldDialog] ?? []).length}
          onClose={() => setShowFieldDialog(null)}
          onCreated={() => { setShowFieldDialog(null); load(); }}
        />
      )}
    </div>
  );
}

function FieldRow({ def, onChanged, companyId }: { def: FieldDefinition; onChanged: () => void; companyId: string }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(def.label);
  const [required, setRequired] = useState(def.is_required);
  const [active, setActive] = useState(def.is_active);

  const save = async () => {
    await supabase.from('field_definitions').update({ label, is_required: required }).eq('id', def.id);
    setEditing(false);
    onChanged();
  };

  const toggleActive = async () => {
    const newVal = !active;
    setActive(newVal);
    await supabase.from('field_definitions').update({ is_active: newVal }).eq('id', def.id);
  };

  const deleteField = async () => {
    await supabase.from('field_definitions').delete().eq('id', def.id);
    onChanged();
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
      {editing ? (
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 flex-1" onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} autoFocus />
      ) : (
        <span className="flex-1 text-sm font-medium">{def.label}</span>
      )}
      <Badge variant="secondary" className="text-xs">{FIELD_TYPES.find((t) => t.value === def.field_type)?.label ?? def.field_type}</Badge>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <Checkbox checked={required} onCheckedChange={(c) => { setRequired(c === true); }} />
        Required
      </label>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={toggleActive} title={active ? 'Active' : 'Inactive'}>
        {active ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(!editing)}>
        <Edit2 className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={deleteField}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CreateGroupDialog({
  companyId,
  recordType,
  sortOrder,
  onClose,
  onCreated,
}: {
  companyId: string;
  recordType: string;
  sortOrder: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await supabase.from('field_groups').insert({
      company_id: companyId,
      name: name.trim(),
      record_type: recordType,
      sort_order: sortOrder,
    });
    onCreated();
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Field Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-xs">Group Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Seller Information" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving || !name.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateFieldDialog({
  companyId,
  groupId,
  recordType,
  sortOrder,
  onClose,
  onCreated,
}: {
  companyId: string;
  groupId: string;
  recordType: string;
  sortOrder: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('short_text');
  const [required, setRequired] = useState(false);
  const [choices, setChoices] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!key.trim() || !label.trim()) return;
    setSaving(true);
    const options: Record<string, unknown> = {};
    if (choices.trim()) {
      options.choices = choices.split(',').map((c) => c.trim()).filter(Boolean);
    }
    await supabase.from('field_definitions').insert({
      company_id: companyId,
      field_group_id: groupId,
      key: key.trim().toLowerCase().replace(/\s+/g, '_'),
      label: label.trim(),
      field_type: fieldType,
      options,
      is_required: required,
      sort_order: sortOrder,
      record_type: recordType,
    });
    onCreated();
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Custom Field</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Field Key (internal name)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. asking_price" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Display Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Asking Price" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Field Type</Label>
            <Select value={fieldType} onValueChange={setFieldType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(fieldType === 'dropdown' || fieldType === 'multi_select') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Choices (comma-separated)</Label>
              <Input value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="Option 1, Option 2, Option 3" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={required} onCheckedChange={(c) => setRequired(c === true)} />
            Required field
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving || !key.trim() || !label.trim()}>Create Field</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
