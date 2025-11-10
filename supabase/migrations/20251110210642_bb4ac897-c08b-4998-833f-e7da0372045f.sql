-- Create storage bucket for user-uploaded videos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-videos',
  'user-videos',
  false,
  524288000, -- 500MB limit
  ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm']
);

-- Create RLS policies for user-uploaded videos
CREATE POLICY "Anyone can upload videos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'user-videos');

CREATE POLICY "Anyone can view their own videos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'user-videos');

CREATE POLICY "Anyone can delete their own videos"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'user-videos');

-- Create a table for custom keywords/search terms
CREATE TABLE IF NOT EXISTS public.search_keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS on search_keywords
ALTER TABLE public.search_keywords ENABLE ROW LEVEL SECURITY;

-- Create policies for search keywords
CREATE POLICY "Anyone can view active keywords"
ON public.search_keywords
FOR SELECT
TO public
USING (is_active = true);

CREATE POLICY "Anyone can create keywords"
ON public.search_keywords
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Anyone can update keywords"
ON public.search_keywords
FOR UPDATE
TO public
USING (true);

-- Create index for faster keyword lookups
CREATE INDEX idx_search_keywords_keyword ON public.search_keywords(keyword);
CREATE INDEX idx_search_keywords_active ON public.search_keywords(is_active);