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

    console.log('🚀 Starting automated pipeline orchestrator...');
    
    const results = {
      videosFetched: 0,
      videosTranscribed: 0,
      embeddingsGenerated: 0,
      errors: [] as string[]
    };

    // Step 1: Fetch new videos from YouTube
    try {
      console.log('📥 Step 1: Fetching videos from YouTube...');
      const fetchResponse = await supabase.functions.invoke('fetch-youtube-videos');
      
      if (fetchResponse.error) {
        throw fetchResponse.error;
      }
      
      results.videosFetched = fetchResponse.data?.totalNewVideos || 0;
      console.log(`✓ Fetched ${results.videosFetched} new videos`);
    } catch (error) {
      const errorMsg = `Failed to fetch videos: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      results.errors.push(errorMsg);
    }

    // Step 2: Transcribe pending videos (batch of 5)
    try {
      console.log('🎙️ Step 2: Transcribing videos...');
      
      const { data: pendingVideos, error: videosError } = await supabase
        .from('videos')
        .select('id, title')
        .eq('status', 'pending')
        .order('published_at', { ascending: false })
        .limit(5);

      if (videosError) {
        throw videosError;
      }

      if (pendingVideos && pendingVideos.length > 0) {
        console.log(`Found ${pendingVideos.length} videos to transcribe`);
        
        for (const video of pendingVideos) {
          try {
            console.log(`Transcribing: ${video.title}`);
            const transcribeResponse = await supabase.functions.invoke('transcribe-video', {
              body: { videoId: video.id }
            });

            if (transcribeResponse.error) {
              throw transcribeResponse.error;
            }

            results.videosTranscribed++;
            console.log(`✓ Transcribed: ${video.title}`);
          } catch (error) {
            const errorMsg = `Failed to transcribe ${video.title}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error(errorMsg);
            results.errors.push(errorMsg);
          }
        }
      } else {
        console.log('No pending videos to transcribe');
      }
    } catch (error) {
      const errorMsg = `Transcription step failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      results.errors.push(errorMsg);
    }

    // Step 3: Generate embeddings for transcribed videos (batch of 5)
    try {
      console.log('✨ Step 3: Generating embeddings...');
      
      const { data: transcribedVideos, error: videosError } = await supabase
        .from('videos')
        .select('id, title')
        .eq('status', 'completed')
        .order('published_at', { ascending: false })
        .limit(5);

      if (videosError) {
        throw videosError;
      }

      if (transcribedVideos && transcribedVideos.length > 0) {
        console.log(`Found ${transcribedVideos.length} videos to generate embeddings for`);
        
        for (const video of transcribedVideos) {
          try {
            console.log(`Generating embeddings: ${video.title}`);
            const embeddingsResponse = await supabase.functions.invoke('generate-embeddings', {
              body: { videoId: video.id }
            });

            if (embeddingsResponse.error) {
              throw embeddingsResponse.error;
            }

            results.embeddingsGenerated++;
            console.log(`✓ Generated embeddings: ${video.title}`);
          } catch (error) {
            const errorMsg = `Failed to generate embeddings for ${video.title}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error(errorMsg);
            results.errors.push(errorMsg);
          }
        }
      } else {
        console.log('No transcribed videos need embeddings');
      }
    } catch (error) {
      const errorMsg = `Embeddings step failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      results.errors.push(errorMsg);
    }

    console.log('🎉 Pipeline orchestrator completed!');
    console.log(`Summary: ${results.videosFetched} fetched, ${results.videosTranscribed} transcribed, ${results.embeddingsGenerated} embeddings generated`);
    
    if (results.errors.length > 0) {
      console.log(`⚠️ ${results.errors.length} errors occurred`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        results,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Pipeline orchestrator error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
