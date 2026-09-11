'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatRelativeTime } from '@/lib/utils/format';
import {
  DispositionRecord, DispositionPipelineStage, Contact, Property,
  AcquisitionRecord, BuyerOffer,
} from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { MapPin, User, DollarSign, Calendar, CheckCircle2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  recordId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  stages: DispositionPipelineStage[];
  onClose: () => void;
  onUpdated: () => void;
}

function formatCurrency(val: number | null | undefined) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

const FINANCING_LABELS: Record<string, string> = {
  cash: 'Cash', conventional: 'Conventional', hard_money: 'Hard Money',
  seller_finance: 'Seller Finance', other: 'Other',
};

const POF_LABELS: Record<string, string> = {
  pending: 'Pending', received: 'Received', verified: 'Verified', rejected: 'Rejected',
};

export function DispositionDrawer({ recordId, companyId, userId, canEdit, stages, onClose, onUpdated }: Props) {
  const [record, setRecord] = useState<DispositionRecord | null>(null);
  const [seller, setSeller] = useState<Contact | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [acquisition, setAcquisition] = useState<AcquisitionRecord | null>(null);
  const [offers, setOffers] = useState<BuyerOffer[]>([]);
  const [offerContacts, setOfferContacts] = useState<Record<string, Contact>>({});
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [activity, setActivity] = useState<{ id: string; event_type: string; created_at: string; metadata: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddOffer, setShowAddOffer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOffer, setNewOffer] = useState({
    contact_id: '', offer_amount: '', financing_type: 'cash' as BuyerOffer['financing_type'],
    proof_of_funds_status: 'pending' as BuyerOffer['proof_of_funds_status'],
    emd_amount: '', offer_date: new Date().toISOString().slice(0, 10),
    expiration_date: '', notes: '',
  });
  const [localRecord, setLocalRecord] = useState<Partial<DispositionRecord>>({});

  const load = useCallback(async () => {
    if (!recordId || !companyId) return;
    setLoading(true);

    const { data: rec } = await supabase.from('disposition_records').select('*').eq('id', recordId).maybeSingle();
    if (!rec) { setLoading(false); return; }
    const r = rec as DispositionRecord;
    setRecord(r);
    setLocalRecord({});

    const [sellerRes, propRes, acqRes, offersRes, actRes, contactsRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', r.contact_id).maybeSingle(),
      supabase.from('properties').select('*').eq('id', r.property_id).maybeSingle(),
      r.acquisition_record_id
        ? supabase.from('acquisition_records').select('*').eq('id', r.acquisition_record_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('buyer_offers').select('*').eq('disposition_record_id', recordId).order('created_at', { ascending: false }),
      supabase.from('activity_events').select('*').eq('entity_id', recordId).order('created_at', { ascending: false }).limit(30),
      supabase.from('contacts').select('id, first_name, last_name, primary_phone, primary_email').eq('company_id', companyId).order('first_name').limit(300),
    ]);

    setSeller(sellerRes.data as Contact ?? null);
    setProperty(propRes.data as Property ?? null);
    setAcquisition(acqRes.data as AcquisitionRecord ?? null);
    const offerList = (offersRes.data ?? []) as BuyerOffer[];
    setOffers(offerList);
    setActivity(actRes.data ?? []);
    setAllContacts((contactsRes.data ?? []) as Contact[]);

    const contactIds = Array.from(new Set(offerList.map((o) => o.contact_id)));
    if (contactIds.length > 0) {
      const { data: oc } = await supabase.from('contacts').select('*').in('id', contactIds);
      const m: Record<string, Contact> = {};
      (oc ?? []).forEach((c) => { m[c.id] = c as Contact; });
      setOfferContacts(m);
    }

    setLoading(false);
  }, [recordId, companyId]);

  useEffect(() => { load(); }, [load]);

  const saveField = async (field: keyof DispositionRecord, value: unknown) => {
    if (!canEdit || !record) return;
    await supabase.from('disposition_records').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', record.id);
    onUpdated();
    load();
  };

  const handleStageChange = async (stageId: string) => {
    if (!record || !canEdit) return;
    const stage = stages.find((s) => s.id === stageId);
    await supabase.from('disposition_records').update({
      pipeline_stage_id: stageId,
      stage_entered_at: new Date().toISOString(),
      status: stage?.is_terminal && stage.name === 'Dead' ? 'dead' : stage?.is_terminal ? 'closed' : 'active',
      updated_at: new Date().toISOString(),
    }).eq('id', record.id);
    await supabase.from('activity_events').insert({
      company_id: companyId, actor_id: userId,
      entity_type: 'disposition_record', entity_id: record.id,
      event_type: 'stage_changed',
      metadata: { from_stage_id: record.pipeline_stage_id, to_stage_id: stageId, to_stage_name: stage?.name },
    });
    onUpdated();
    load();
  };

  const addOffer = async () => {
    if (!newOffer.contact_id || !newOffer.offer_amount || !record) return;
    setSaving(true);
    await supabase.from('buyer_offers').insert({
      company_id: companyId,
      disposition_record_id: record.id,
      contact_id: newOffer.contact_id,
      offer_amount: parseFloat(newOffer.offer_amount),
      financing_type: newOffer.financing_type,
      proof_of_funds_status: newOffer.proof_of_funds_status,
      emd_amount: newOffer.emd_amount ? parseFloat(newOffer.emd_amount) : null,
      offer_date: newOffer.offer_date,
      expiration_date: newOffer.expiration_date || null,
      notes: newOffer.notes || null,
      status: 'pending',
    });
    await supabase.from('activity_events').insert({
      company_id: companyId, actor_id: userId,
      entity_type: 'disposition_record', entity_id: record.id,
      event_type: 'buyer_offer_added',
      metadata: { contact_id: newOffer.contact_id, offer_amount: newOffer.offer_amount },
    });
    setShowAddOffer(false);
    setNewOffer({ contact_id: '', offer_amount: '', financing_type: 'cash', proof_of_funds_status: 'pending', emd_amount: '', offer_date: new Date().toISOString().slice(0, 10), expiration_date: '', notes: '' });
    setSaving(false);
    onUpdated();
    load();
  };

  const acceptOffer = async (offer: BuyerOffer) => {
    if (!canEdit || !record) return;
    // Reject all others first
    await supabase.from('buyer_offers').update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('disposition_record_id', record.id)
      .eq('status', 'accepted');
    await supabase.from('buyer_offers').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', offer.id);
    await supabase.from('disposition_records').update({
      buyer_price: offer.offer_amount,
      emd_amount: offer.emd_amount ?? record.emd_amount,
      updated_at: new Date().toISOString(),
    }).eq('id', record.id);
    onUpdated();
    load();
  };

  const currentStage = stages.find((s) => s.id === record?.pipeline_stage_id);
  const contractPrice = record?.contract_price ?? acquisition?.offer_amount ?? null;
  const spread = contractPrice && record?.buyer_price ? record.buyer_price - contractPrice : null;

  if (loading || !record) return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-[580px] max-w-full">
        <div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>
      </SheetContent>
    </Sheet>
  );

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-[620px] max-w-full overflow-y-auto flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="text-lg font-semibold truncate">
                  {property?.street_address ?? 'Disposition'}
                </SheetTitle>
                {property && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {property.city}, {property.state} {property.zip_code}
                  </p>
                )}
              </div>
              {currentStage && (
                <Badge style={{ background: currentStage.color, color: '#fff' }} className="shrink-0 text-xs">
                  {currentStage.name}
                </Badge>
              )}
            </div>

            {/* Stage selector */}
            {canEdit && (
              <Select value={record.pipeline_stage_id} onValueChange={handleStageChange}>
                <SelectTrigger className="mt-2 h-8 text-sm">
                  <SelectValue placeholder="Move to stage..." />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SheetHeader>

          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-6 mt-3 mb-0 w-auto justify-start shrink-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="offers">
                Buyer Offers
                {offers.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">{offers.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Key financials */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">Contract Price</p>
                  <p className="text-base font-bold">{formatCurrency(contractPrice)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">Buyer Price</p>
                  <p className="text-base font-bold">{formatCurrency(record.buyer_price)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">Est. Spread</p>
                  <p className={cn('text-base font-bold', spread == null ? '' : spread >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {formatCurrency(spread)}
                  </p>
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Contract Price</Label>
                    <Input type="number" placeholder="0"
                      defaultValue={record.contract_price ?? ''}
                      onBlur={(e) => saveField('contract_price', e.target.value ? parseFloat(e.target.value) : null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Buyer Price</Label>
                    <Input type="number" placeholder="0"
                      defaultValue={record.buyer_price ?? ''}
                      onBlur={(e) => saveField('buyer_price', e.target.value ? parseFloat(e.target.value) : null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">EMD Amount</Label>
                    <Input type="number" placeholder="0"
                      defaultValue={record.emd_amount ?? ''}
                      onBlur={(e) => saveField('emd_amount', e.target.value ? parseFloat(e.target.value) : null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">EMD Received Date</Label>
                    <Input type="date"
                      defaultValue={record.emd_received_date ?? ''}
                      onBlur={(e) => saveField('emd_received_date', e.target.value || null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Closing Date</Label>
                    <Input type="date"
                      defaultValue={record.closing_date ?? ''}
                      onBlur={(e) => saveField('closing_date', e.target.value || null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Title Company</Label>
                    <Input placeholder="Title company name"
                      defaultValue={record.title_company ?? ''}
                      onBlur={(e) => saveField('title_company', e.target.value || null)}
                      className="h-8 text-sm" disabled={!canEdit} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    defaultValue={record.notes ?? ''}
                    onBlur={(e) => saveField('notes', e.target.value || null)}
                    rows={3} className="text-sm resize-none" disabled={!canEdit} />
                </div>
              </div>

              {/* Linked people */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</p>
                {seller && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">Seller:</span>
                    <span>{seller.first_name} {seller.last_name}</span>
                    {seller.primary_phone && <span className="text-muted-foreground">· {seller.primary_phone}</span>}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Buyer Offers */}
            <TabsContent value="offers" className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Buyer Offers</h3>
                {canEdit && (
                  <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setShowAddOffer(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add Offer
                  </Button>
                )}
              </div>

              {offers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No offers yet.</p>
              ) : (
                <div className="space-y-3">
                  {offers.map((offer) => {
                    const buyer = offerContacts[offer.contact_id];
                    const isAccepted = offer.status === 'accepted';
                    return (
                      <div key={offer.id} className={cn(
                        'rounded-lg border p-3 space-y-2',
                        isAccepted && 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20',
                      )}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-semibold">{formatCurrency(offer.offer_amount)}</p>
                            <p className="text-xs text-muted-foreground">
                              {buyer ? `${buyer.first_name} ${buyer.last_name}` : 'Unknown buyer'}
                              {' · '}{FINANCING_LABELS[offer.financing_type]}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isAccepted && (
                              <Badge className="text-[10px] bg-emerald-600 text-white">Accepted</Badge>
                            )}
                            {offer.status === 'pending' && (
                              <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                            )}
                            {offer.status === 'rejected' && (
                              <Badge variant="destructive" className="text-[10px]">Rejected</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          <span>POF: {POF_LABELS[offer.proof_of_funds_status]}</span>
                          {offer.emd_amount && <span>EMD: {formatCurrency(offer.emd_amount)}</span>}
                          {offer.expiration_date && <span>Exp: {offer.expiration_date}</span>}
                        </div>
                        {offer.notes && <p className="text-xs text-muted-foreground">{offer.notes}</p>}
                        {canEdit && offer.status === 'pending' && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                              onClick={() => acceptOffer(offer)}>
                              <CheckCircle2 className="h-3 w-3" /> Accept
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-600 hover:text-red-700"
                              onClick={async () => {
                                await supabase.from('buyer_offers').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', offer.id);
                                onUpdated(); load();
                              }}>
                              <X className="h-3 w-3" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* Activity */}
            <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 py-4">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((ev) => (
                    <div key={ev.id} className="flex gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                      <div>
                        <p className="font-medium capitalize">{ev.event_type.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(ev.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Add Offer Dialog */}
      {showAddOffer && (
        <Dialog open onOpenChange={() => setShowAddOffer(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Buyer Offer</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Buyer Contact *</Label>
                <Select value={newOffer.contact_id} onValueChange={(v) => setNewOffer({ ...newOffer, contact_id: v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select buyer..." /></SelectTrigger>
                  <SelectContent>
                    {allContacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Offer Amount *</Label>
                  <Input type="number" placeholder="0" value={newOffer.offer_amount}
                    onChange={(e) => setNewOffer({ ...newOffer, offer_amount: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">EMD Amount</Label>
                  <Input type="number" placeholder="0" value={newOffer.emd_amount}
                    onChange={(e) => setNewOffer({ ...newOffer, emd_amount: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Financing Type</Label>
                  <Select value={newOffer.financing_type} onValueChange={(v) => setNewOffer({ ...newOffer, financing_type: v as BuyerOffer['financing_type'] })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FINANCING_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Proof of Funds</Label>
                  <Select value={newOffer.proof_of_funds_status} onValueChange={(v) => setNewOffer({ ...newOffer, proof_of_funds_status: v as BuyerOffer['proof_of_funds_status'] })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(POF_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Offer Date</Label>
                  <Input type="date" value={newOffer.offer_date}
                    onChange={(e) => setNewOffer({ ...newOffer, offer_date: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expiration Date</Label>
                  <Input type="date" value={newOffer.expiration_date}
                    onChange={(e) => setNewOffer({ ...newOffer, expiration_date: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea value={newOffer.notes} onChange={(e) => setNewOffer({ ...newOffer, notes: e.target.value })} rows={2} className="text-sm resize-none" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddOffer(false)}>Cancel</Button>
              <Button onClick={addOffer} disabled={saving || !newOffer.contact_id || !newOffer.offer_amount}>
                {saving ? 'Adding…' : 'Add Offer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
