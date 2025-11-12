import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Innertube } from "https://esm.sh/youtubei.js@10.5.0/web.bundle.min.js";

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

// Pick the best audio-only stream
async function resolveAudioUrl(youtube_id: string): Promise<string> {
  const yt = await Innertube.create();
  const info = await yt.getInfo(youtube_id);

  console.log(`[resolveAudioUrl] Got video info for ${youtube_id}`);
  
  // Check what streaming data we have
  const streamingData = info.streaming_data;
  console.log(`[resolveAudioUrl] streaming_data exists: ${!!streamingData}`);
  
  if (!streamingData) {
    throw new Error("No streaming data available - video may be restricted");
  }

  const formats = streamingData.formats ?? [];
  const adaptiveFormats = streamingData.adaptive_formats ?? [];
  console.log(`[resolveAudioUrl] formats: ${formats.length}, adaptive_formats: ${adaptiveFormats.length}`);

  // Try adaptive formats first (audio-only)
  const audioOnly = adaptiveFormats
    .filter((f: any) => {
      const mimeType = f.mime_type ?? f.mimeType ?? "";
      const hasUrl = !!f.url;
      const isAudio = mimeType.startsWith("audio/");
      console.log(`[resolveAudioUrl] Format: mime=${mimeType}, hasUrl=${hasUrl}, isAudio=${isAudio}`);
      return isAudio && hasUrl;
    })
    .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (audioOnly.length > 0) {
    console.log(`[resolveAudioUrl] Found ${audioOnly.length} audio-only formats, using best`);
    return audioOnly[0].url!;
  }

  // Fallback: try any format with audio (including video+audio)
  console.log(`[resolveAudioUrl] No audio-only formats, trying combined formats...`);
  const allFormats = [...formats, ...adaptiveFormats];
  const anyAudio = allFormats
    .filter((f: any) => {
      const hasUrl = !!f.url;
      const mimeType = f.mime_type ?? f.mimeType ?? "";
      console.log(`[resolveAudioUrl] Combined format: mime=${mimeType}, hasUrl=${hasUrl}`);
      return hasUrl && (mimeType.includes("audio") || f.has_audio);
    })
    .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (anyAudio.length > 0) {
    console.log(`[resolveAudioUrl] Using combined audio+video format`);
    return anyAudio[0].url!;
  }

  throw new Error("No direct audio URL found (format blocked or ciphered).");
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

    const { youtube_id } = await req.json();
    
    if (!youtube_id) {
      return new Response(
        JSON.stringify({ error: 'Missing youtube_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

    console.log(`Starting transcription submission for YouTube ID: ${youtube_id}`);

    // Get video details by youtube_id
    const videoRes = await fetch(
      `${supabaseUrl}/rest/v1/videos?select=*&youtube_id=eq.${youtube_id}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    const videos = await videoRes.json();
    if (!Array.isArray(videos) || videos.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Video not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const video = videos[0];

    // GATE 1: Check if video is live or still processing using YouTube API
    console.log(`Checking video status for YouTube ID: ${youtube_id}`);
    
    const videoDetailsResponse = await fetchWithRetry(
      `${YOUTUBE_API_URL}/videos?part=snippet,contentDetails,liveStreamingDetails&id=${video.youtube_id}&key=${youtubeApiKey}`,
      { method: 'GET' }
    );

    if (!videoDetailsResponse.ok) {
      throw new Error(`YouTube API error: ${await videoDetailsResponse.text()}`);
    }

    const videoDetails = await videoDetailsResponse.json();
    
    if (!videoDetails.items || videoDetails.items.length === 0) {
      await fetch(
        `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'failed',
            error_reason: 'video_not_found',
          }),
        }
      );
      
      return new Response(
        JSON.stringify({ error: 'Video not found on YouTube', code: 'video_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ytVideo = videoDetails.items[0];
    
    // Check if duration is available (most important check)
    if (!ytVideo.contentDetails?.duration) {
      await fetch(
        `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'failed',
            error_reason: 'no_duration',
          }),
        }
      );
      
      console.log(`Video ${video.youtube_id} has no duration (still processing or live)`);
      return new Response(
        JSON.stringify({ error: 'Video still processing on YouTube or currently live', code: 'no_duration' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only block if actively live (has started but not ended)
    const isCurrentlyLive = ytVideo.liveStreamingDetails?.actualStartTime && 
                           !ytVideo.liveStreamingDetails?.actualEndTime;
    
    if (isCurrentlyLive) {
      await fetch(
        `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'failed',
            error_reason: 'currently_live',
          }),
        }
      );
      
      console.log(`Video ${video.youtube_id} is currently live streaming`);
      return new Response(
        JSON.stringify({ error: 'Video is currently live', code: 'currently_live' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Video passed validation (duration: ${ytVideo.contentDetails.duration}). Extracting direct audio stream...`);

    // Resolve direct audio URL using youtubei.js
    let audioUrl: string;
    try {
      audioUrl = await resolveAudioUrl(youtube_id);
      console.log(`Successfully resolved direct audio URL (length: ${audioUrl.length} chars)`);
    } catch (error) {
      console.error('Failed to resolve audio URL:', error);
      await fetch(
        `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'failed',
            error_reason: 'audio_extraction_failed',
          }),
        }
      );
      
      throw new Error(`Audio extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log(`Submitting direct audio stream to AssemblyAI...`);

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
            audio_url: audioUrl,
            language_code: 'en',
          }),
        }
      );
    } catch (error) {
      console.error('AssemblyAI submission failed after retries:', error);
      await fetch(
        `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'failed',
            error_reason: 'assemblyai_submission_failed',
          }),
        }
      );
      
      throw error;
    }

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error('AssemblyAI submission error:', errorText);
      
      // Check if it's an unreachable audio error (members-only, unlisted, etc.)
      if (errorText.includes('could not be reached') || errorText.includes('unreachable')) {
        await fetch(
          `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({
              status: 'failed',
              error_reason: 'unreachable_audio',
            }),
          }
        );
        
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
    await fetch(
      `${supabaseUrl}/rest/v1/videos?youtube_id=eq.${youtube_id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'processing',
          transcript_id: transcriptId,
          processing_started_at: new Date().toISOString(),
          error_reason: null,
        }),
      }
    );

    console.log(`✓ Transcription submitted successfully for: ${video.title}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Transcription submitted',
        youtube_id,
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
