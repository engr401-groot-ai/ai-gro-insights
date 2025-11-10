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
    // Verify authentication
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
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has admin role
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

    console.log(`Processing: ${video.title}`);
    console.log(`YouTube URL: ${video.url}`);
    console.log(`YouTube ID: ${video.youtube_id}`);

    // Try to get audio download URL using youtube-dl-exec approach
    // This extracts the direct audio stream URL from YouTube
    let audioUrl: string | null = null;
    
    try {
      // Use yt-dlp JSON format to get audio URL
      const ytDlpCommand = new Deno.Command("yt-dlp", {
        args: [
          "-f", "bestaudio[ext=m4a]/bestaudio",
          "-g", // Get direct URL
          "--no-playlist",
          video.url
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { stdout, stderr, success } = await ytDlpCommand.output();
      
      if (success) {
        audioUrl = new TextDecoder().decode(stdout).trim();
        console.log("Got audio URL via yt-dlp");
      } else {
        console.warn("yt-dlp not available or failed:", new TextDecoder().decode(stderr));
      }
    } catch (error) {
      console.warn("yt-dlp not available:", error);
    }

    if (!audioUrl || !audioUrl.startsWith('http')) {
      throw new Error('Failed to get audio URL from YouTube');
    }

    console.log("Downloading audio from YouTube...");
    
    const audioResponse = await fetch(audioUrl);
    
    if (!audioResponse.ok || !audioResponse.body) {
      throw new Error('Failed to download audio');
    }

    const audioBlob = await audioResponse.blob();
    const audioSize = audioBlob.size;
    
    console.log(`Audio downloaded: ${(audioSize / 1024 / 1024).toFixed(2)} MB`);

    if (audioSize > 25 * 1024 * 1024) {
      throw new Error('Audio file too large for Whisper API (max 25MB)');
    }

    // Send to OpenAI Whisper
    console.log("Sending to OpenAI Whisper API...");
    
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.m4a');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'verbose_json');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('Whisper API error:', errorText);
      throw new Error(`Whisper API error: ${errorText}`);
    }

    const whisperData = await whisperResponse.json();
    const transcriptionText = whisperData.text;
    
    console.log(`Transcription completed: ${transcriptionText.length} characters`);

    // Insert transcription
    const { data: transcription, error: transcriptionError } = await supabase
      .from('transcriptions')
      .insert({
        video_id: videoId,
        full_text: transcriptionText,
        language: 'en'
      })
      .select()
      .single();

    if (transcriptionError) {
      throw transcriptionError;
    }

    // Split into segments (approximately every 500 characters or by sentence)
    const segments = splitIntoSegments(transcriptionText);
    
    console.log(`Creating ${segments.length} transcript segments...`);
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const totalDuration = video.duration || 3600;
      const startTime = Math.floor((i / segments.length) * totalDuration);
      const endTime = Math.floor(((i + 1) / segments.length) * totalDuration);

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
      .update({ status: 'completed' })
      .eq('id', videoId);

    console.log(`✓ Transcription completed for: ${video.title}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        transcriptionId: transcription.id,
        segmentCount: segments.length,
        charactersTranscribed: transcriptionText.length
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
