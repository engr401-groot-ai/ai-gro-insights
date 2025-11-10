import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SearchResult {
  id: string;
  videoTitle: string;
  channel: string;
  url: string;
  excerpt: string;
  relevanceScore: number;
  timestamp: string;
  publishedAt: string;
  date: string;
  videoId: string;
  isFullTranscript?: boolean;
}

export const useSemanticSearch = () => {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const search = async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('semantic-search', {
        body: { query, matchThreshold: 0.7, matchCount: 10 }
      });

      if (error) throw error;

      // Transform the results to match our interface
      const transformedResults: SearchResult[] = data.results.map((result: any) => ({
        id: result.id,
        videoId: result.video_id,
        videoTitle: result.video_title,
        channel: result.channel_name,
        url: result.video_url,
        excerpt: result.segment_text || result.content_text,
        relevanceScore: Math.round(result.similarity * 100),
        timestamp: result.is_full_transcript ? 'Full Transcript' : formatTimestamp(result.start_time),
        publishedAt: new Date(result.published_at).toLocaleDateString(),
        date: new Date(result.published_at).toLocaleDateString(),
        isFullTranscript: result.is_full_transcript || false
      }));

      setResults(transformedResults);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return { results, isSearching, search };
};

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
