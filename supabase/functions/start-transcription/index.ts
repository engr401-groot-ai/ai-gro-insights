import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { YoutubeTranscript } from "https://esm.sh/youtube-transcript@1.2.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

// Retry with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  initialDelay = 1000
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
    
    // Exponential backoff
    if (attempt < maxRetries - 1) {
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

// Modal handles video download, so we don't need resolveAudioUrl anymore

/** Fetch official YouTube captions/transcript */
async function fetchOfficialTranscript(youtube_id: string) {
  console.log(`[fetchOfficialTranscript] Attempting to fetch captions for ${youtube_id}`);
  const items = await YoutubeTranscript.fetchTranscript(youtube_id);
  if (!items || items.length === 0) {
    throw new Error("no_official_captions");
  }
  console.log(`[fetchOfficialTranscript] Found ${items.length} caption items`);
  return items;
}

/** Convert caption items into ~30s segments with 5s overlap */
function segmentCaptions30s(items: { text: string; duration: number; offset: number }[]) {
  const SEG = 30, OVERLAP = 5;
  const out: { start: number; end: number; text: string }[] = [];
  if (!items.length) return out;

  let t = Math.floor(items[0].offset);
  const endAll = Math.floor(items[items.length - 1].offset + items[items.length - 1].duration);

  while (t < endAll) {
    const winStart = t;
    const winEnd = Math.min(t + SEG, endAll);
    const chunkText = items
      .filter(it => it.offset < winEnd && (it.offset + it.duration) > winStart)
      .map(it => it.text)
      .join(" ")
      .trim();

    if (chunkText) out.push({ start: winStart, end: winEnd, text: chunkText });
    t += (SEG - OVERLAP);
  }
  console.log(`[segmentCaptions30s] Created ${out.length} segments from captions`);
  return out;
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
    const modalEndpointUrl = Deno.env.get('MODAL_ENDPOINT_URL')!;
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY')!;
    
    if (!modalEndpointUrl) {
      return new Response(
        JSON.stringify({ error: 'MODAL_ENDPOINT_URL not configured. Please deploy Modal service and add endpoint URL.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

    console.log(`Video passed validation (duration: ${ytVideo.contentDetails.duration}). Submitting to Modal Whisper...`);

    const youtubeUrl = `https://www.youtube.com/watch?v=${youtube_id}`;

    // Update video status to processing
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
          processing_started_at: new Date().toISOString(),
          error_reason: null,
        }),
      }
    );

    // Call Modal Whisper service with retry logic
    let modalResponse;
    try {
      console.log(`Calling Modal endpoint: ${modalEndpointUrl}`);
      modalResponse = await fetchWithRetry(
        modalEndpointUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_url: youtubeUrl,
          }),
        },
        3, // 3 retries
        5000 // 5 second initial delay
      );
    } catch (modalErr) {
      const modalErrorMsg = modalErr instanceof Error ? modalErr.message : String(modalErr);
      console.error(`Modal request failed after retries: ${modalErrorMsg}. Trying caption fallback...`);
      
      // Fallback to official captions if Modal completely fails
      try {
        const caps = await fetchOfficialTranscript(youtube_id);
        const segments = segmentCaptions30s(
          caps.map((c: any) => ({ text: c.text, duration: c.duration, offset: c.offset }))
        );

        if (!segments.length) {
          throw new Error("No segments created from captions");
        }

        console.log(`Using caption fallback after Modal failure: ${segments.length} segments`);
        
        const fullText = segments.map(s => s.text).join(" ");

        // Insert full transcription
        const transRes = await fetch(
          `${supabaseUrl}/rest/v1/transcriptions`,
          {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify({
              video_id: video.id,
              full_text: fullText,
            }),
          }
        );

        const transcriptionData = await transRes.json();
        const transcriptionId = Array.isArray(transcriptionData) ? transcriptionData[0].id : transcriptionData.id;

        // Insert segments
        const segmentRows = segments.map((seg) => ({
          video_id: video.id,
          segment_text: seg.text,
          start_time: seg.start,
          end_time: seg.end,
        }));

        await fetch(
          `${supabaseUrl}/rest/v1/transcript_segments`,
          {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(segmentRows),
          }
        );

        // Mark as completed
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
              status: 'completed',
              transcript_id: transcriptionId,
              error_reason: null
            }),
          }
        );

        // Trigger embeddings generation
        try {
          await supabase.functions.invoke("batch-generate-embeddings", {
            body: { youtube_id },
          });
        } catch (embedErr) {
          console.error("Failed to trigger embeddings:", embedErr);
        }

        return new Response(
          JSON.stringify({ 
            success: true,
            message: "Transcription completed using caption fallback (Modal unavailable)",
            youtube_id,
            segments_count: segments.length,
            method: "captions"
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (capErr) {
        const capErrorMsg = capErr instanceof Error ? capErr.message : String(capErr);
        console.error(`Caption fallback also failed: ${capErrorMsg}`);
        
        // Both Modal and captions failed
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
              error_reason: 'modal_and_captions_failed'
            }),
          }
        );

        return new Response(
          JSON.stringify({ 
            error: "Modal service unavailable and no captions available",
            youtube_id,
            modal_error: modalErrorMsg,
            caption_error: capErrorMsg
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check Modal response status
    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      console.error(`Modal returned error: ${errorText}`);
      
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
            error_reason: 'modal_error',
          }),
        }
      );
      
      throw new Error(`Modal transcription failed: ${errorText}`);
    }

    const modalData = await modalResponse.json();
    console.log('Modal transcription completed successfully');

    // Store the full transcript
    const transRes = await fetch(
      `${supabaseUrl}/rest/v1/transcriptions`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          video_id: video.id,
          full_text: modalData.text,
        }),
      }
    );

    const transcriptionData = await transRes.json();
    const transcriptionId = Array.isArray(transcriptionData) ? transcriptionData[0].id : transcriptionData.id;

    // Store segments if provided
    if (modalData.segments && modalData.segments.length > 0) {
      const segmentRows = modalData.segments.map((seg: any) => ({
        video_id: video.id,
        segment_text: seg.text,
        start_time: Math.floor(seg.start),
        end_time: Math.floor(seg.end),
      }));

      await fetch(
        `${supabaseUrl}/rest/v1/transcript_segments`,
        {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(segmentRows),
        }
      );
    }

    // Mark video as completed
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
          status: 'completed',
          transcript_id: transcriptionId,
          error_reason: null,
        }),
      }
    );

    // Trigger embeddings generation
    try {
      await supabase.functions.invoke("batch-generate-embeddings", {
        body: { youtube_id },
      });
    } catch (embedErr) {
      console.error("Failed to trigger embeddings:", embedErr);
    }

    console.log(`✓ Transcription completed successfully for: ${video.title}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Transcription completed via Modal Whisper',
        youtube_id,
        segments_count: modalData.segments?.length || 0,
        method: 'modal_whisper',
        status: 'completed'
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
