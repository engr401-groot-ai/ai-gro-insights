import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';

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
      
      if (response.ok || (response.status !== 403 && response.status !== 429 && response.status < 500)) {
        return response;
      }
      
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error as Error;
    }
    
    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

// Create 30-second segments with 5-second overlap
function createTimeBasedSegments(
  words: Array<{ text: string; start: number; end: number }>,
  windowMs = 30000,
  overlapMs = 5000
): Array<{ text: string; start: number; end: number }> {
  if (!words || words.length === 0) return [];
  
  const segments: Array<{ text: string; start: number; end: number }> = [];
  const strideMs = windowMs - overlapMs;
  
  let segmentStartMs = words[0].start;
  
  while (segmentStartMs <= words[words.length - 1].end) {
    const segmentEndMs = segmentStartMs + windowMs;
    
    // Find words within this window
    const wordsInSegment = words.filter(
      word => word.start >= segmentStartMs && word.start < segmentEndMs
    );
    
    if (wordsInSegment.length > 0) {
      const segmentText = wordsInSegment.map(w => w.text).join(' ');
      const actualStart = wordsInSegment[0].start;
      const actualEnd = wordsInSegment[wordsInSegment.length - 1].end;
      
      segments.push({
        text: segmentText,
        start: actualStart,
        end: actualEnd
      });
    }
    
    segmentStartMs += strideMs;
  }
  
  return segments;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const assemblyaiApiKey = Deno.env.get('ASSEMBLYAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Checking transcription status for all processing videos...');

    // Get all videos with status 'processing' and transcript_id
    const { data: processingVideos, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('status', 'processing')
      .not('transcript_id', 'is', null);

    if (fetchError) {
      throw fetchError;
    }

    if (!processingVideos || processingVideos.length === 0) {
      console.log('No videos currently processing');
      return new Response(
        JSON.stringify({ message: 'No videos processing', checked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${processingVideos.length} videos to check`);

    let completed = 0;
    let failed = 0;
    let stillProcessing = 0;
    let timedOut = 0;

    for (const video of processingVideos) {
      try {
        // Check for timeout (6 hours)
        const startedAt = new Date(video.processing_started_at);
        const now = new Date();
        const hoursSinceStart = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceStart > 6) {
          console.log(`Video ${video.id} timed out after ${hoursSinceStart.toFixed(2)} hours`);
          await supabase
            .from('videos')
            .update({ 
              status: 'failed',
              error_reason: 'processing_timeout',
              processing_completed_at: new Date().toISOString()
            })
            .eq('id', video.id);
          timedOut++;
          continue;
        }

        // Check status with retry logic
        const statusResponse = await fetchWithRetry(
          `${ASSEMBLYAI_API_URL}/transcript/${video.transcript_id}`,
          {
            headers: {
              'Authorization': assemblyaiApiKey,
            },
          }
        );

        if (!statusResponse.ok) {
          console.error(`Failed to check status for video ${video.id}`);
          continue;
        }

        const transcriptionData = await statusResponse.json();
        console.log(`Video ${video.id}: ${transcriptionData.status}`);

        if (transcriptionData.status === 'completed') {
          // Process completed transcription
          const transcriptionText = transcriptionData.text;

          if (!transcriptionText || transcriptionText.length < 50) {
            await supabase
              .from('videos')
              .update({ 
                status: 'failed',
                error_reason: 'no_usable_text',
                processing_completed_at: new Date().toISOString()
              })
              .eq('id', video.id);
            failed++;
            continue;
          }

          // Insert full transcription
          const { data: transcription, error: transcriptionError } = await supabase
            .from('transcriptions')
            .insert({
              video_id: video.id,
              full_text: transcriptionText,
              language: 'en'
            })
            .select()
            .single();

          if (transcriptionError) {
            console.error('Transcription insert error:', transcriptionError);
            failed++;
            continue;
          }

          // Create 30-second segments with 5-second overlap
          const words = transcriptionData.words || [];
          console.log(`Processing ${words.length} words into 30s segments...`);
          
          const segments = createTimeBasedSegments(words, 30000, 5000);
          console.log(`Created ${segments.length} time-based segments`);

          // Prepare segments for database
          const segmentsData = segments.map(segment => ({
            transcription_id: transcription.id,
            video_id: video.id,
            segment_text: segment.text.trim(),
            start_time: Math.floor(segment.start / 1000),
            end_time: Math.floor(segment.end / 1000),
          }));

          // Insert segments in batches of 50
          for (let i = 0; i < segmentsData.length; i += 50) {
            const batch = segmentsData.slice(i, i + 50);
            await supabase.from('transcript_segments').insert(batch);
          }

          // Export JSONL to storage
          const jsonlLines = segmentsData.map(seg => 
            JSON.stringify({
              video_id: video.youtube_id,
              start: seg.start_time,
              end: seg.end_time,
              text: seg.segment_text
            })
          ).join('\n');

          const jsonlBlob = new Blob([jsonlLines], { type: 'application/json' });
          
          await supabase.storage
            .from('transcripts')
            .upload(`normalized/${video.youtube_id}.jsonl`, jsonlBlob, {
              contentType: 'application/json',
              upsert: true
            });

          console.log(`Exported JSONL for ${video.youtube_id}`);

          // Update video to completed
          await supabase
            .from('videos')
            .update({ 
              status: 'completed',
              processing_completed_at: new Date().toISOString()
            })
            .eq('id', video.id);

          console.log(`✓ Completed: ${video.title}`);
          completed++;

        } else if (transcriptionData.status === 'error') {
          await supabase
            .from('videos')
            .update({ 
              status: 'failed',
              error_reason: `assemblyai_error: ${transcriptionData.error || 'unknown'}`,
              processing_completed_at: new Date().toISOString()
            })
            .eq('id', video.id);
          
          console.error(`AssemblyAI error for video ${video.id}: ${transcriptionData.error}`);
          failed++;

        } else {
          // Still processing
          stillProcessing++;
        }

      } catch (error) {
        console.error(`Error processing video ${video.id}:`, error);
        failed++;
      }
    }

    const summary = {
      checked: processingVideos.length,
      completed,
      failed,
      timedOut,
      stillProcessing
    };

    console.log('Status check complete:', summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-transcription-status:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
