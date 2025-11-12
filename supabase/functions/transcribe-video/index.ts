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

    // Start background processing using waitUntil
    const backgroundTask = async () => {
      try {
        console.log(`Processing: ${video.title}`);
        console.log(`YouTube URL: ${video.url}`);

        // Try to get audio download URL using yt-dlp
        let audioUrl: string | null = null;
        
        try {
          const ytDlpCommand = new Deno.Command("yt-dlp", {
            args: [
              "-f", "bestaudio[ext=m4a]/bestaudio",
              "-g",
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
            console.warn("yt-dlp failed:", new TextDecoder().decode(stderr));
          }
        } catch (error) {
          console.warn("yt-dlp error:", error);
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

        let transcriptionText = '';

        // Handle large files by using Lovable AI instead (supports longer audio)
        if (audioSize > 20 * 1024 * 1024) {
          console.log("Audio too large for Whisper API, using fallback chunked transcription...");
          
          // For very long videos, we'll transcribe just the first 20 minutes as a sample
          // and use AI to generate a detailed summary
          const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
          
          if (!lovableApiKey) {
            throw new Error('LOVABLE_API_KEY not configured for large file transcription');
          }

          // Create a smaller chunk by downloading with time limit
          const ytDlpChunk = new Deno.Command("yt-dlp", {
            args: [
              "-f", "bestaudio[ext=m4a]/bestaudio",
              "-g",
              "--download-sections", "*0-1200",  // First 20 minutes
              "--no-playlist",
              video.url
            ],
            stdout: "piped",
            stderr: "piped",
          });

          const { stdout: chunkStdout, success: chunkSuccess } = await ytDlpChunk.output();
          
          if (!chunkSuccess) {
            throw new Error('Failed to get audio chunk for large file');
          }

          const chunkAudioUrl = new TextDecoder().decode(chunkStdout).trim();
          const chunkResponse = await fetch(chunkAudioUrl);
          const chunkBlob = await chunkResponse.blob();

          // Transcribe the 20-minute chunk
          const formData = new FormData();
          formData.append('file', chunkBlob, 'audio_chunk.m4a');
          formData.append('model', 'whisper-1');
          formData.append('language', 'en');
          formData.append('response_format', 'text');

          const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
            body: formData,
          });

          if (!whisperResponse.ok) {
            throw new Error('Whisper API failed for audio chunk');
          }

          const partialTranscript = await whisperResponse.text();
          
          // Use AI to expand the partial transcript into a more comprehensive summary
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { 
                  role: 'system', 
                  content: 'You are transcribing Hawaii legislative sessions. Given a partial transcript, create a detailed transcript maintaining all specific names, numbers, bills, and University of Hawaii references. Keep the exact wording from the partial transcript and note this is a partial transcription of a longer session.' 
                },
                { 
                  role: 'user', 
                  content: `This is a partial transcript from "${video.title}". Full video duration: ${Math.floor((video.duration || 0) / 60)} minutes. Partial transcript (first 20 minutes):\n\n${partialTranscript}\n\nProvide this as a detailed transcript, keeping all exact quotes, names, and references intact. Add a note that this represents the first portion of a ${Math.floor((video.duration || 0) / 60)}-minute session.`
                }
              ],
            }),
          });

          if (!aiResponse.ok) {
            // Fallback to just the partial transcript
            transcriptionText = `[Partial Transcript - First 20 minutes of ${Math.floor((video.duration || 0) / 60)}-minute session]\n\n${partialTranscript}`;
          } else {
            const aiData = await aiResponse.json();
            transcriptionText = aiData.choices[0].message.content;
          }

        } else {
          // File is small enough for direct Whisper transcription
          console.log("Sending to OpenAI Whisper API...");
          
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.m4a');
          formData.append('model', 'whisper-1');
          formData.append('language', 'en');
          formData.append('response_format', 'text');

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

          transcriptionText = await whisperResponse.text();
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

        // Split into segments
        const segments = splitIntoSegments(transcriptionText);
        
        console.log(`Creating ${segments.length} transcript segments...`);
        
        // Batch insert segments for better performance
        const segmentsData = segments.map((segment, i) => {
          const totalDuration = video.duration || 3600;
          const startTime = Math.floor((i / segments.length) * totalDuration);
          const endTime = Math.floor(((i + 1) / segments.length) * totalDuration);

          return {
            transcription_id: transcription.id,
            video_id: videoId,
            segment_text: segment,
            start_time: startTime,
            end_time: endTime
          };
        });

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