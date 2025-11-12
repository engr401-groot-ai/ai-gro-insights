-- Add transcript_id and error tracking to videos table
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS transcript_id text,
ADD COLUMN IF NOT EXISTS error_reason text,
ADD COLUMN IF NOT EXISTS processing_started_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS processing_completed_at timestamp with time zone;

-- Create storage bucket for transcript exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('transcripts', 'transcripts', false, 52428800, ARRAY['application/json', 'text/plain'])
ON CONFLICT (id) DO NOTHING;

-- Allow admins to write transcripts
CREATE POLICY "Admins can upload transcripts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'transcripts' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Allow admins to read transcripts
CREATE POLICY "Admins can read transcripts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'transcripts' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);