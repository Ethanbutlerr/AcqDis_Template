'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldGroup, FieldDefinition, FieldValue } from '@/lib/types';

export function CustomFieldsSection({
  entityType,
  entityId,
  companyId,
}: {
  entityType: string;
  entityId: string;
  companyId: string;
}) {
  const [groups, setGroups] = useState<FieldGroup[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, FieldDefinition[]>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const { data: groupData } = await supabase
      .from('field_groups')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_type', entityType)
      .eq('is_active', true)
      .order('sort_order');

    const { data: defData } = await supabase
      .from('field_definitions')
      .select('*')
      .eq('company_id', companyId)
      .eq('record_type', entityType)
      .eq('is_active', true)
      .order('sort_order');

    const { data: valData } = await supabase
      .from('field_values')
      .select('*')
      .eq('company_id', companyId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);

    const valMap: Record<string, unknown> = {};
    (valData ?? []).forEach((v: FieldValue) => {
      valMap[v.field_definition_id] = v.value;
    });

    const defMap: Record<string, FieldDefinition[]> = {};
    (groupData ?? []).forEach((g: FieldGroup) => {
      defMap[g.id] = (defData ?? []).filter((d: FieldDefinition) => d.field_group_id === g.id);
    });

    setGroups((groupData ?? []) as FieldGroup[]);
    setDefinitions(defMap);
    setValues(valMap);
    setLoading(false);
  }, [entityType, entityId, companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateValue = async (defId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [defId]: value }));
    const existing = Object.entries(values).find(([k]) => k === defId);
    if (existing) {
      await supabase.from('field_values').update({ value }).eq('field_definition_id', defId).eq('entity_id', entityId);
    } else {
      await supabase.from('field_values').insert({
        company_id: companyId,
        field_definition_id: defId,
        entity_type: entityType,
        entity_id: entityId,
        value,
      });
    }
  };

  if (loading) return null;

  if (groups.length === 0) return null;

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const defs = definitions[group.id] ?? [];
        if (defs.length === 0) return null;
        return (
          <div key={group.id} className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {group.name}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              {defs.map((def) => (
                <FieldInput
                  key={def.id}
                  def={def}
                  value={values[def.id]}
                  onChange={(val) => updateValue(def.id, val)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDefinition;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const label = (
    <Label className="text-xs text-muted-foreground">
      {def.label}
      {def.is_required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );

  const options = (def.options?.choices ?? []) as string[];

  switch (def.field_type) {
    case 'short_text':
    case 'phone':
    case 'url':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.label}
          />
        </div>
      );
    case 'long_text':
      return (
        <div className="space-y-1.5 sm:col-span-2">
          {label}
          <Textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.label}
            className="min-h-[80px]"
          />
        </div>
      );
    case 'number':
    case 'currency':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
            placeholder={def.label}
          />
        </div>
      );
    case 'percentage':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="0-100"
          />
        </div>
      );
    case 'date':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </div>
      );
    case 'datetime':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="datetime-local"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </div>
      );
    case 'checkbox':
      return (
        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            checked={(value as boolean) ?? false}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          {label}
        </div>
      );
    case 'dropdown':
      return (
        <div className="space-y-1.5">
          {label}
          <Select
            value={(value as string) ?? ''}
            onValueChange={(val) => onChange(val || null)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case 'email':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="email"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.label}
          />
        </div>
      );
    default:
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.label}
          />
        </div>
      );
  }
}
