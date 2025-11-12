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
    const modalEndpointUrl = Deno.env.get('MODAL_ENDPOINT_URL')!;
    
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

        // Call Modal Whisper service
        console.log("Submitting to Modal Whisper service...");
        
        const modalResponse = await fetch(modalEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_url: video.url
          }),
        });

        if (!modalResponse.ok) {
          const errorText = await modalResponse.text();
          throw new Error(`Modal Whisper error (${modalResponse.status}): ${errorText}`);
        }

        const transcriptionData = await modalResponse.json();
        console.log("✓ Transcription completed!");

        const transcriptionText = transcriptionData.text;
        const segments = transcriptionData.segments || [];

        if (!transcriptionText || transcriptionText.length < 50) {
          throw new Error('Transcription resulted in no usable text');
        }
        
        console.log(`Transcription completed: ${transcriptionText.length} characters, ${segments.length} segments`);

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

        console.log(`Processing ${segments.length} segments with timestamps...`);
        
        // Prepare segments for database insertion (Modal returns segments with start/end in seconds)
        const segmentsData = segments.map((segment: any) => ({
          transcription_id: transcription.id,
          video_id: videoId,
          segment_text: segment.text.trim(),
          start_time: Math.floor(segment.start),
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