import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

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

    // Start background processing using waitUntil
    const backgroundTask = async () => {
      try {
        console.log(`Processing: ${video.title}`);
        console.log(`YouTube URL: ${video.url}`);

        // Step 1: Download audio using yt-dlp
        console.log("Downloading audio from YouTube...");
        
        const ytDlpProcess = new Deno.Command("yt-dlp", {
          args: [
            "-f", "bestaudio",
            "--extract-audio",
            "--audio-format", "mp3",
            "--output", "-",
            video.url
          ],
          stdout: "piped",
          stderr: "piped"
        });

        const { stdout, stderr, success } = await ytDlpProcess.output();
        
        if (!success) {
          const errorText = new TextDecoder().decode(stderr);
          throw new Error(`Failed to download audio: ${errorText}`);
        }

        console.log("Audio downloaded, submitting to OpenAI Whisper...");

        // Step 2: Submit to OpenAI Whisper API
        const formData = new FormData();
        const audioBlob = new Blob([stdout], { type: 'audio/mpeg' });
        formData.append('file', audioBlob, 'audio.mp3');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');

        const transcribeResponse = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
          },
          body: formData,
        });

        if (!transcribeResponse.ok) {
          const errorText = await transcribeResponse.text();
          throw new Error(`OpenAI Whisper error: ${errorText}`);
        }

        const transcriptionData = await transcribeResponse.json();
        console.log("✓ Transcription completed!");

        const transcriptionText = transcriptionData.text;

        if (!transcriptionText || transcriptionText.length < 50) {
          throw new Error('Transcription resulted in no usable text');
        }
        
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

        // Step 3: Process timestamped segments from OpenAI Whisper
        const segments = transcriptionData.segments || [];
        console.log(`Processing ${segments.length} segments with timestamps...`);
        
        // Prepare segments for database insertion
        const segmentsData = segments.map((segment: any) => ({
          transcription_id: transcription.id,
          video_id: videoId,
          segment_text: segment.text.trim(),
          start_time: Math.floor(segment.start), // Already in seconds
          end_time: Math.floor(segment.end),
        }));

        // Insert in batches of 50 to avoid overwhelming the database
        for (let i = 0; i < segmentsData.length; i += 50) {
          const batch = segmentsData.slice(i, i + 50);
          await supabase.from('transcript_segments').insert(batch);
          console.log(`Inserted segment batch ${Math.floor(i/50) + 1}/${Math.ceil(segmentsData.length/50)}`);
        }

        // Update video status to completed
        await supabase
          .from('videos')
          .update({ status: 'completed' })
          .eq('id', videoId);

        console.log(`✓ Transcription completed for: ${video.title}`);
      } catch (error) {
        console.error('Background transcription error:', error);
        // Update video status to failed
        await supabase
          .from('videos')
          .update({ status: 'failed' })
          .eq('id', videoId);
      }
    };

    // Use waitUntil for background processing
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined') {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundTask());
    } else {
      // Fallback for local development
      backgroundTask();
    }

    // Return immediately
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Transcription started',
        videoId,
        status: 'processing'
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