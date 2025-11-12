import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

// Retry with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Only retry on 403, 429, and 5xx errors
      if (response.ok || (response.status !== 403 && response.status !== 429 && response.status < 500)) {
        return response;
      }
      
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error as Error;
    }
    
    // Exponential backoff: 1s, 4s, 10s
    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { videoId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const assemblyaiApiKey = Deno.env.get('ASSEMBLYAI_API_KEY')!;
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify authentication and admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting transcription submission for video ID: ${videoId}`);

    // Get video details
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    // GATE 1: Check if video is live or still processing using YouTube API
    console.log(`Checking video status for YouTube ID: ${video.youtube_id}`);
    
    const videoDetailsResponse = await fetchWithRetry(
      `${YOUTUBE_API_URL}/videos?part=snippet,contentDetails,liveStreamingDetails&id=${video.youtube_id}&key=${youtubeApiKey}`,
      { method: 'GET' }
    );

    if (!videoDetailsResponse.ok) {
      throw new Error(`YouTube API error: ${await videoDetailsResponse.text()}`);
    }

    const videoDetails = await videoDetailsResponse.json();
    
    if (!videoDetails.items || videoDetails.items.length === 0) {
      await supabase
        .from('videos')
        .update({ 
          status: 'failed',
          error_reason: 'video_not_found'
        })
        .eq('id', videoId);
      
      return new Response(
        JSON.stringify({ error: 'Video not found on YouTube', code: 'video_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ytVideo = videoDetails.items[0];
    
    // Check if live stream
    if (ytVideo.snippet.liveBroadcastContent !== 'none') {
      await supabase
        .from('videos')
        .update({ 
          status: 'failed',
          error_reason: 'live_stream_no_vod'
        })
        .eq('id', videoId);
      
      console.log(`Video ${video.youtube_id} is a live stream without VOD`);
      return new Response(
        JSON.stringify({ error: 'Video is a live stream without VOD', code: 'live_stream_no_vod' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if duration is available
    if (!ytVideo.contentDetails?.duration) {
      await supabase
        .from('videos')
        .update({ 
          status: 'failed',
          error_reason: 'no_duration'
        })
        .eq('id', videoId);
      
      console.log(`Video ${video.youtube_id} has no duration (still processing)`);
      return new Response(
        JSON.stringify({ error: 'Video still processing on YouTube', code: 'no_duration' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Video passed initial checks. Submitting to AssemblyAI...`);

    // GATE 2: Submit to AssemblyAI with retry logic
    let submitResponse;
    try {
      submitResponse = await fetchWithRetry(
        `${ASSEMBLYAI_API_URL}/transcript`,
        {
          method: 'POST',
          headers: {
            'Authorization': assemblyaiApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audio_url: video.url,
            language_code: 'en',
          }),
        }
      );
    } catch (error) {
      console.error('AssemblyAI submission failed after retries:', error);
      await supabase
        .from('videos')
        .update({ 
          status: 'failed',
          error_reason: 'assemblyai_submission_failed'
        })
        .eq('id', videoId);
      
      throw error;
    }

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error('AssemblyAI submission error:', errorText);
      
      // Check if it's an unreachable audio error (members-only, unlisted, etc.)
      if (errorText.includes('could not be reached') || errorText.includes('unreachable')) {
        await supabase
          .from('videos')
          .update({ 
            status: 'failed',
            error_reason: 'unreachable_audio'
          })
          .eq('id', videoId);
        
        return new Response(
          JSON.stringify({ 
            error: 'Audio unreachable (members-only, unlisted, or private)', 
            code: 'unreachable_audio' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AssemblyAI submission error: ${errorText}`);
    }

    const { id: transcriptId } = await submitResponse.json();
    console.log(`AssemblyAI transcript ID: ${transcriptId}`);

    // Update video with transcript_id and set to processing
    await supabase
      .from('videos')
      .update({ 
        status: 'processing',
        transcript_id: transcriptId,
        processing_started_at: new Date().toISOString(),
        error_reason: null
      })
      .eq('id', videoId);

    console.log(`✓ Transcription submitted successfully for: ${video.title}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Transcription submitted',
        videoId,
        transcriptId,
        status: 'processing'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in start-transcription:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
