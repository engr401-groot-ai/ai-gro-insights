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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🚀 Starting batch embedding generation for all pending videos');

    // Find all videos that have segments without embeddings
    const { data: videosNeedingEmbeddings, error: queryError } = await supabase
      .rpc('get_videos_needing_embeddings');

    if (queryError) {
      // Fallback to direct query if RPC doesn't exist
      const { data: videos, error } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          transcript_segments!inner (
            id,
            embedding
          )
        `)
        .eq('status', 'completed');

      if (error) throw error;

      // Filter to videos with null embeddings
      const videoIds = new Set<string>();
      videos?.forEach((v: any) => {
        if (v.transcript_segments.some((s: any) => s.embedding === null)) {
          videoIds.add(v.id);
        }
      });

      const videoList = Array.from(videoIds).map(id => 
        videos?.find((v: any) => v.id === id)
      );

      return await processVideos(supabase, videoList);
    }

    return await processVideos(supabase, videosNeedingEmbeddings);

  } catch (error) {
    console.error('Error in batch-generate-embeddings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function processVideos(supabase: any, videos: any[]) {
  if (!videos || videos.length === 0) {
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'No videos need embeddings',
        processedCount: 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Found ${videos.length} videos needing embeddings`);
  const results = [];

  for (const video of videos) {
    try {
      console.log(`Processing video: ${video.title}`);
      
      // Call generate-embeddings for this video
      const { data, error } = await supabase.functions.invoke('generate-embeddings', {
        body: { videoId: video.id }
      });

      if (error) {
        console.error(`Error processing ${video.title}:`, error);
        results.push({ video: video.title, status: 'error', error: error.message });
      } else {
        console.log(`✓ Processed ${video.title}: ${data.processedCount} segments`);
        results.push({ video: video.title, status: 'success', processedCount: data.processedCount });
      }

      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Exception processing ${video.title}:`, error);
      results.push({ 
        video: video.title, 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      totalVideos: videos.length,
      results
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
