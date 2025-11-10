-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Table to store YouTube channels we're monitoring
CREATE TABLE public.youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table to store videos
CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id TEXT NOT NULL UNIQUE,
  channel_id UUID REFERENCES public.youtube_channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  duration INTEGER, -- in seconds
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'transcribing', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table to store transcriptions
CREATE TABLE public.transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  full_text TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table to store transcript segments with embeddings for RAG
CREATE TABLE public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  transcription_id UUID REFERENCES public.transcriptions(id) ON DELETE CASCADE,
  segment_text TEXT NOT NULL,
  start_time INTEGER NOT NULL, -- in seconds
  end_time INTEGER NOT NULL, -- in seconds
  embedding vector(1536), -- OpenAI ada-002 or similar
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table to store chat conversations
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT, -- can be session ID or user identifier
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table to store individual chat messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sources JSONB, -- store references to video segments used
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table to track search queries for analytics
CREATE TABLE public.search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text TEXT NOT NULL,
  query_type TEXT CHECK (query_type IN ('keyword', 'semantic', 'chat')),
  results_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_videos_channel_id ON public.videos(channel_id);
CREATE INDEX idx_videos_published_at ON public.videos(published_at DESC);
CREATE INDEX idx_videos_status ON public.videos(status);
CREATE INDEX idx_transcriptions_video_id ON public.transcriptions(video_id);
CREATE INDEX idx_transcript_segments_video_id ON public.transcript_segments(video_id);
CREATE INDEX idx_transcript_segments_embedding ON public.transcript_segments USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages(conversation_id);
CREATE INDEX idx_chat_conversations_created_at ON public.chat_conversations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (since this is a public search tool)
CREATE POLICY "Allow public read access to channels" ON public.youtube_channels FOR SELECT USING (true);
CREATE POLICY "Allow public read access to videos" ON public.videos FOR SELECT USING (true);
CREATE POLICY "Allow public read access to transcriptions" ON public.transcriptions FOR SELECT USING (true);
CREATE POLICY "Allow public read access to segments" ON public.transcript_segments FOR SELECT USING (true);
CREATE POLICY "Allow public read access to search queries" ON public.search_queries FOR SELECT USING (true);

-- Chat conversations and messages - users can only see their own
CREATE POLICY "Users can view own conversations" ON public.chat_conversations FOR SELECT USING (true);
CREATE POLICY "Users can create conversations" ON public.chat_conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own messages" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "Users can create messages" ON public.chat_messages FOR INSERT WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_youtube_channels_updated_at
  BEFORE UPDATE ON public.youtube_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial YouTube channels
INSERT INTO public.youtube_channels (channel_id, channel_name, channel_url) VALUES
  ('UCkc1Rhmo-v-KOPx66XaLBjA', 'Senate Hawaii', 'https://www.youtube.com/@senatehawaii'),
  ('UCNXOmHZAhIs5VHjlcuXLG9g', 'House of Representatives Hawaii', 'https://www.youtube.com/@HawaiiHouseofRepresentatives')
ON CONFLICT (channel_id) DO NOTHING;

-- Function for semantic search
CREATE OR REPLACE FUNCTION public.search_transcript_segments(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  video_id UUID,
  segment_text TEXT,
  start_time INTEGER,
  end_time INTEGER,
  similarity float,
  video_title TEXT,
  video_url TEXT,
  channel_name TEXT,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.video_id,
    ts.segment_text,
    ts.start_time,
    ts.end_time,
    1 - (ts.embedding <=> query_embedding) as similarity,
    v.title as video_title,
    v.url as video_url,
    yc.channel_name,
    v.published_at
  FROM public.transcript_segments ts
  JOIN public.videos v ON ts.video_id = v.id
  JOIN public.youtube_channels yc ON v.channel_id = yc.id
  WHERE 1 - (ts.embedding <=> query_embedding) > match_threshold
  ORDER BY ts.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;