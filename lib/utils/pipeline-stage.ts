import { supabase } from '@/lib/supabase/client';

export type PipelineName = 'acquisition' | 'disposition' | 'management';

export async function movePipelineStage<T>({
  pipeline,
  recordId,
  expectedStageId,
  toStageId,
  note,
  requestId,
}: {
  pipeline: PipelineName;
  recordId: string;
  expectedStageId: string;
  toStageId: string;
  note: string;
  requestId: string;
}) {
  const { data, error } = await supabase.rpc('move_pipeline_stage', {
    p_pipeline: pipeline,
    p_record_id: recordId,
    p_expected_stage_id: expectedStageId,
    p_to_stage_id: toStageId,
    p_note: note,
    p_request_id: requestId,
  });

  if (error) throw new Error(error.message);
  const result = data as { record?: T } | null;
  if (!result?.record) throw new Error('The stage move completed without returning the saved record.');
  return result.record;
}

export async function createAcquisitionOpportunity<T>({
  stageId,
  contact,
  property,
  acquisition,
  requestId,
}: {
  stageId: string;
  contact: Record<string, unknown>;
  property: Record<string, unknown>;
  acquisition: Record<string, unknown>;
  requestId: string;
}) {
  const { data, error } = await supabase.rpc('create_acquisition_opportunity', {
    p_stage_id: stageId,
    p_contact: contact,
    p_property: property,
    p_acquisition: acquisition,
    p_request_id: requestId,
  });

  if (error) throw new Error(error.message);
  const result = data as { record?: T } | null;
  if (!result?.record) throw new Error('The opportunity was created without returning its acquisition record.');
  return result.record;
}

export async function createPipelineOpportunity<T>({
  pipeline,
  stageId,
  contact,
  property,
  details,
  requestId,
}: {
  pipeline: 'acquisition' | 'disposition';
  stageId: string;
  contact: Record<string, unknown>;
  property: Record<string, unknown>;
  details: Record<string, unknown>;
  requestId: string;
}) {
  const { data, error } = await supabase.rpc('create_pipeline_opportunity', {
    p_pipeline: pipeline,
    p_stage_id: stageId,
    p_contact: contact,
    p_property: property,
    p_details: details,
    p_request_id: requestId,
  });

  if (error) throw new Error(error.message);
  const result = data as { record?: T; pipeline?: string } | null;
  if (!result?.record) throw new Error('The opportunity was created without returning its pipeline record.');
  return result as { record: T; pipeline?: string };
}
