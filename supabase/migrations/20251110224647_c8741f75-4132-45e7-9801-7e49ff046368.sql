-- Fix search_path security warning for the new search function
DROP FUNCTION IF EXISTS public.search_transcripts_and_segments(vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.search_transcripts_and_segments(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  video_id uuid,
  content_text text,
  start_time integer,
  end_time integer,
  similarity double precision,
  video_title text,
  video_url text,
  channel_name text,
  published_at timestamp with time zone,
  is_full_transcript boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- Search transcript segments
  SELECT
    ts.id,
    ts.video_id,
    ts.segment_text as content_text,
    ts.start_time,
    ts.end_time,
    1 - (ts.embedding <=> query_embedding) as similarity,
    v.title as video_title,
    v.url as video_url,
    yc.channel_name,
    v.published_at,
    false as is_full_transcript
  FROM public.transcript_segments ts
  JOIN public.videos v ON ts.video_id = v.id
  JOIN public.youtube_channels yc ON v.channel_id = yc.id
  WHERE ts.embedding IS NOT NULL
    AND 1 - (ts.embedding <=> query_embedding) > match_threshold
  
  UNION ALL
  
  -- Search full transcripts
  SELECT
    t.id,
    t.video_id,
    t.full_text as content_text,
    0 as start_time,
    0 as end_time,
    1 - (t.embedding <=> query_embedding) as similarity,
    v.title as video_title,
    v.url as video_url,
    yc.channel_name,
    v.published_at,
    true as is_full_transcript
  FROM public.transcriptions t
  JOIN public.videos v ON t.video_id = v.id
  JOIN public.youtube_channels yc ON v.channel_id = yc.id
  WHERE t.embedding IS NOT NULL
    AND 1 - (t.embedding <=> query_embedding) > match_threshold
  
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;