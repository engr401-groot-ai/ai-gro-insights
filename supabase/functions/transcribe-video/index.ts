import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';

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
    const assemblyaiApiKey = Deno.env.get('ASSEMBLYAI_API_KEY')!;
    
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

        // AssemblyAI requires a publicly accessible audio URL
        // We'll use the video URL directly since AssemblyAI can handle YouTube URLs
        console.log("Using YouTube URL directly with AssemblyAI...");
        
        const audioUrl = video.url;

        console.log("Got audio URL, submitting to AssemblyAI...");

        // Step 1: Submit audio URL to AssemblyAI
        const submitResponse = await fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
          method: 'POST',
          headers: {
            'Authorization': assemblyaiApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audio_url: audioUrl,
            language_code: 'en',
          }),
        });

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();
          throw new Error(`AssemblyAI submission error: ${errorText}`);
        }

        const { id: transcriptId } = await submitResponse.json();
        console.log(`AssemblyAI transcript ID: ${transcriptId}`);

        // Step 2: Poll for completion
        console.log("Waiting for transcription to complete...");
        let transcriptionData: any = null;
        let pollAttempts = 0;
        const maxPollAttempts = 180; // 30 minutes max (10-second intervals)

        while (pollAttempts < maxPollAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          
          const statusResponse = await fetch(`${ASSEMBLYAI_API_URL}/transcript/${transcriptId}`, {
            headers: {
              'Authorization': assemblyaiApiKey,
            },
          });

          if (!statusResponse.ok) {
            throw new Error('Failed to check transcription status');
          }

          transcriptionData = await statusResponse.json();
          console.log(`Transcription status: ${transcriptionData.status}`);

          if (transcriptionData.status === 'completed') {
            console.log("✓ Transcription completed!");
            break;
          } else if (transcriptionData.status === 'error') {
            throw new Error(`AssemblyAI transcription failed: ${transcriptionData.error}`);
          }

          pollAttempts++;
        }

        if (!transcriptionData || transcriptionData.status !== 'completed') {
          throw new Error('Transcription timed out');
        }

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

        // Step 3: Process timestamped segments from AssemblyAI
        // Get sentences with timestamps (if available)
        const words = transcriptionData.words || [];
        console.log(`Processing ${words.length} words with timestamps...`);
        
        // Group words into segments of ~500 characters
        const segments: Array<{ text: string; start: number; end: number }> = [];
        let currentSegment = { text: '', start: 0, end: 0 };
        
        for (const word of words) {
          if (!currentSegment.start) {
            currentSegment.start = word.start;
          }
          
          const wordText = word.text + ' ';
          
          if (currentSegment.text.length + wordText.length > 500 && currentSegment.text.length > 0) {
            currentSegment.end = word.end;
            segments.push({ ...currentSegment });
            currentSegment = { text: wordText, start: word.start, end: word.end };
          } else {
            currentSegment.text += wordText;
            currentSegment.end = word.end;
          }
        }
        
        // Add the last segment
        if (currentSegment.text.trim()) {
          segments.push(currentSegment);
        }

        console.log(`Created ${segments.length} transcript segments with timestamps`);
        
        // Prepare segments for database insertion
        const segmentsData = segments.map(segment => ({
          transcription_id: transcription.id,
          video_id: videoId,
          segment_text: segment.text.trim(),
          start_time: Math.floor(segment.start / 1000), // Convert ms to seconds
          end_time: Math.floor(segment.end / 1000),
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