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
    const { videoId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting transcription for video ID: ${videoId}`);

    // Get video details
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    // Update status to processing
    await supabase
      .from('videos')
      .update({ status: 'processing' })
      .eq('id', videoId);

    // Download audio from YouTube (using yt-dlp or similar)
    // For now, we'll simulate this with a placeholder
    console.log(`Downloading audio for: ${video.url}`);
    
    // In a real implementation, you would:
    // 1. Download the audio using yt-dlp or youtube-dl
    // 2. Convert to appropriate format
    // 3. Send to OpenAI Whisper API
    
    // For demonstration, we'll create a mock transcription
    // In production, you'd use: const audioBlob = await downloadYouTubeAudio(video.url);
    
    // Simulated transcription - in production, call Whisper API
    const mockTranscription = `This is a transcription of ${video.title}. The committee discussed various topics related to the University of Hawaii system, including budget allocations, research funding, and student support programs. The discussion covered the need for increased resources at UH Manoa campus and the broader UH system.`;
    
    // In production, uncomment this:
    /*
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities', 'segment');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: formData,
    });

    const transcriptionData = await whisperResponse.json();
    */

    // Insert transcription
    const { data: transcription, error: transcriptionError } = await supabase
      .from('transcriptions')
      .insert({
        video_id: videoId,
        full_text: mockTranscription,
        language: 'en'
      })
      .select()
      .single();

    if (transcriptionError) {
      throw transcriptionError;
    }

    // Split into segments (approximately every 30 seconds or by sentence)
    const segments = splitIntoSegments(mockTranscription);
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const startTime = i * 30;
      const endTime = (i + 1) * 30;

      await supabase
        .from('transcript_segments')
        .insert({
          transcription_id: transcription.id,
          video_id: videoId,
          segment_text: segment,
          start_time: startTime,
          end_time: endTime
        });
    }

    // Update video status
    await supabase
      .from('videos')
      .update({ status: 'transcribed' })
      .eq('id', videoId);

    console.log(`Transcription completed for video: ${video.title}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        transcriptionId: transcription.id,
        segmentCount: segments.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcribe-video:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function splitIntoSegments(text: string): string[] {
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
  const segments: string[] = [];
  let currentSegment = '';
  
  for (const sentence of sentences) {
    if (currentSegment.length + sentence.length > 500) {
      if (currentSegment) {
        segments.push(currentSegment.trim());
      }
      currentSegment = sentence;
    } else {
      currentSegment += ' ' + sentence;
    }
  }
  
  if (currentSegment) {
    segments.push(currentSegment.trim());
  }
  
  return segments;
}
