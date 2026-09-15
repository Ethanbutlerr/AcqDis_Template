'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fullAddress, formatDate } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type ReviewStatus = 'confirmed_distinct' | 'duplicate' | 'dismissed';
type Review = {
  id: string;
  opportunity_id: string;
  matched_opportunity_id: string;
  normalized_address: string;
  created_at: string;
};
type OpportunitySummary = { id: string; property_id: string | null; created_at: string };
type PropertySummary = { id: string; street_address: string; city: string | null; state: string | null; zip_code: string | null };

export function DuplicateReviewDialog({
  open,
  companyId,
  userId,
  onClose,
  onChanged,
}: {
  open: boolean;
  companyId: string;
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [opportunities, setOpportunities] = useState<Record<string, OpportunitySummary>>({});
  const [properties, setProperties] = useState<Record<string, PropertySummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: reviewError } = await supabase
      .from('opportunity_duplicate_reviews')
      .select('id, opportunity_id, matched_opportunity_id, normalized_address, created_at')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (reviewError) {
      setError(reviewError.message);
      setLoading(false);
      return;
    }

    const loadedReviews = (data ?? []) as Review[];
    const opportunityIds = Array.from(new Set(loadedReviews.flatMap((review) => [review.opportunity_id, review.matched_opportunity_id])));
    const { data: opportunityData, error: opportunityError } = opportunityIds.length
      ? await supabase.from('opportunities').select('id, property_id, created_at').eq('company_id', companyId).in('id', opportunityIds)
      : { data: [], error: null };
    if (opportunityError) {
      setError(opportunityError.message);
      setLoading(false);
      return;
    }

    const opportunityMap: Record<string, OpportunitySummary> = {};
    (opportunityData ?? []).forEach((opportunity) => { opportunityMap[opportunity.id] = opportunity as OpportunitySummary; });
    const propertyIds = Array.from(new Set(Object.values(opportunityMap).map((opportunity) => opportunity.property_id).filter((id): id is string => !!id)));
    const { data: propertyData, error: propertyError } = propertyIds.length
      ? await supabase.from('properties').select('id, street_address, city, state, zip_code').eq('company_id', companyId).in('id', propertyIds)
      : { data: [], error: null };
    if (propertyError) {
      setError(propertyError.message);
      setLoading(false);
      return;
    }

    const propertyMap: Record<string, PropertySummary> = {};
    (propertyData ?? []).forEach((property) => { propertyMap[property.id] = property as PropertySummary; });
    setReviews(loadedReviews);
    setOpportunities(opportunityMap);
    setProperties(propertyMap);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const addressFor = useMemo(() => (opportunityId: string) => {
    const opportunity = opportunities[opportunityId];
    const property = opportunity?.property_id ? properties[opportunity.property_id] : null;
    return property ? fullAddress(property) : 'Address unavailable';
  }, [opportunities, properties]);

  const resolve = async (reviewId: string, status: ReviewStatus) => {
    if (!userId) return;
    setSavingId(reviewId);
    setError('');
    const { error: updateError } = await supabase.from('opportunity_duplicate_reviews').update({
      status,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', reviewId).eq('company_id', companyId).eq('status', 'pending');
    setSavingId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setReviews((current) => current.filter((review) => review.id !== reviewId));
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Possible Repeat Properties</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Review only. No contacts, properties, or opportunities are merged or deleted here.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading reviews…</p>
        ) : reviews.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No possible repeats need review.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{addressFor(review.opportunity_id)}</p>
                    <p className="text-xs text-muted-foreground">Submitted {formatDate(review.created_at)}</p>
                  </div>
                  <Badge variant="secondary">Needs review</Badge>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <span className="text-muted-foreground">Existing opportunity: </span>
                  {addressFor(review.matched_opportunity_id)}
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button size="sm" variant="ghost" disabled={savingId === review.id} onClick={() => resolve(review.id, 'dismissed')}>Dismiss</Button>
                  <Button size="sm" variant="outline" disabled={savingId === review.id} onClick={() => resolve(review.id, 'confirmed_distinct')}>Keep Separate</Button>
                  <Button size="sm" disabled={savingId === review.id} onClick={() => resolve(review.id, 'duplicate')}>Mark Duplicate</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
