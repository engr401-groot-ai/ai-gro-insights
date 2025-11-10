import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, matchThreshold = 0.7, matchCount = 10 } = await req.json();
    
    // Validate query
    if (!query) {
      throw new Error('Query is required');
    }
    
    if (typeof query !== 'string' || query.length < 2 || query.length > 500) {
      return new Response(
        JSON.stringify({ error: 'Query must be between 2 and 500 characters' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Validate matchThreshold
    if (typeof matchThreshold !== 'number' || matchThreshold < 0 || matchThreshold > 1) {
      return new Response(
        JSON.stringify({ error: 'matchThreshold must be between 0 and 1' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Validate matchCount
    if (typeof matchCount !== 'number' || matchCount < 1 || matchCount > 50) {
      return new Response(
        JSON.stringify({ error: 'matchCount must be between 1 and 50' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const isShortQuery = query.trim().split(/\s+/).length <= 3;
    console.log(`Performing ${isShortQuery ? 'hybrid' : 'semantic'} search for: "${query}"`);

    let results;

    if (isShortQuery) {
      // Use keyword search for short queries (better for acronyms like "HRE")
      const searchPattern = `%${query}%`;
      const { data: keywordResults, error: keywordError } = await supabase
        .from('transcript_segments')
        .select(`
          id,
          video_id,
          segment_text,
          start_time,
          end_time,
          videos!inner (
            id,
            title,
            url,
            published_at,
            youtube_channels!inner (
              channel_name
            )
          )
        `)
        .ilike('segment_text', searchPattern)
        .not('embedding', 'is', null)
        .limit(matchCount);

      if (keywordError) throw keywordError;

      // Transform to match semantic search format
      results = keywordResults?.map((r: any) => ({
        id: r.id,
        video_id: r.video_id,
        segment_text: r.segment_text,
        start_time: r.start_time,
        end_time: r.end_time,
        similarity: 0.9, // High fixed score for keyword matches
        video_title: r.videos.title,
        video_url: r.videos.url,
        channel_name: r.videos.youtube_channels.channel_name,
        published_at: r.videos.published_at
      })) || [];
    } else {
      // Use semantic search for longer queries
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: query,
        }),
      });

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate query embedding');
      }

      const embeddingData = await embeddingResponse.json();
      const queryEmbedding = embeddingData.data[0].embedding;

      // Search both segments and full transcripts using the new database function
      const { data: semanticResults, error: searchError } = await supabase
        .rpc('search_transcripts_and_segments', {
          query_embedding: queryEmbedding,
          match_threshold: matchThreshold,
          match_count: matchCount
        });

      if (searchError) {
        console.error('Search error:', searchError);
        throw searchError;
      }
      
      // Transform results to match expected format
      results = semanticResults?.map((r: any) => ({
        id: r.id,
        video_id: r.video_id,
        segment_text: r.content_text,
        start_time: r.start_time,
        end_time: r.end_time,
        similarity: r.similarity,
        video_title: r.video_title,
        video_url: r.video_url,
        channel_name: r.channel_name,
        published_at: r.published_at,
        is_full_transcript: r.is_full_transcript
      })) || [];
    }

    // Log the search query
    await supabase
      .from('search_queries')
      .insert({
        query_text: query,
        query_type: 'semantic',
        results_count: results?.length || 0
      });

    console.log(`Found ${results?.length || 0} results`);

    return new Response(
      JSON.stringify({ 
        success: true,
        results: results || [],
        query
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in semantic-search:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
