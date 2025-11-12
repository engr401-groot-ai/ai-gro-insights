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

        // For large files, download audio and split into chunks
        console.log("Downloading full audio file...");
        
        // Use yt-dlp to download the audio file locally
        const audioFileName = `audio_${videoId}.m4a`;
        const downloadCommand = new Deno.Command("yt-dlp", {
          args: [
            "-f", "bestaudio[ext=m4a]/bestaudio",
            "-o", audioFileName,
            "--no-playlist",
            video.url
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { success: downloadSuccess, stderr: downloadStderr } = await downloadCommand.output();
        
        if (!downloadSuccess) {
          console.error("Download failed:", new TextDecoder().decode(downloadStderr));
          throw new Error('Failed to download audio file');
        }

        // Get file size
        const fileInfo = await Deno.stat(audioFileName);
        const fileSizeMB = fileInfo.size / (1024 * 1024);
        console.log(`Audio file size: ${fileSizeMB.toFixed(2)} MB`);

        let transcriptionText = '';

        if (fileSizeMB <= 24) {
          // File is small enough for single Whisper call
          console.log("Transcribing with single Whisper call...");
          
          const audioData = await Deno.readFile(audioFileName);
          const blob = new Blob([audioData], { type: 'audio/m4a' });
          
          const formData = new FormData();
          formData.append('file', blob, 'audio.m4a');
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
            throw new Error(`Whisper API error: ${errorText}`);
          }

          transcriptionText = await whisperResponse.text();
          
        } else {
          // File too large - split into 20-minute chunks and transcribe each
          console.log(`Large file detected (${fileSizeMB.toFixed(2)} MB), splitting into chunks...`);
          
          const videoDuration = video.duration || 3600;
          const chunkDurationSeconds = 1200; // 20 minutes per chunk
          const numChunks = Math.ceil(videoDuration / chunkDurationSeconds);
          
          console.log(`Splitting into ${numChunks} chunks of ~20 minutes each`);

          const transcripts: string[] = [];

          for (let i = 0; i < numChunks; i++) {
            const startTime = i * chunkDurationSeconds;
            const chunkFileName = `chunk_${videoId}_${i}.m4a`;
            
            console.log(`Processing chunk ${i + 1}/${numChunks} (starting at ${Math.floor(startTime / 60)}:${(startTime % 60).toString().padStart(2, '0')})...`);

            // Extract chunk using ffmpeg
            const ffmpegCommand = new Deno.Command("ffmpeg", {
              args: [
                "-i", audioFileName,
                "-ss", startTime.toString(),
                "-t", chunkDurationSeconds.toString(),
                "-c", "copy",
                chunkFileName
              ],
              stdout: "piped",
              stderr: "piped",
            });

            const { success: ffmpegSuccess } = await ffmpegCommand.output();
            
            if (!ffmpegSuccess) {
              console.warn(`Failed to extract chunk ${i + 1}, skipping...`);
              continue;
            }

            // Transcribe chunk
            const chunkData = await Deno.readFile(chunkFileName);
            const chunkBlob = new Blob([chunkData], { type: 'audio/m4a' });
            
            const formData = new FormData();
            formData.append('file', chunkBlob, `chunk_${i}.m4a`);
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

            if (whisperResponse.ok) {
              const chunkTranscript = await whisperResponse.text();
              transcripts.push(chunkTranscript);
              console.log(`✓ Chunk ${i + 1} transcribed (${chunkTranscript.length} chars)`);
            } else {
              console.warn(`Failed to transcribe chunk ${i + 1}`);
            }

            // Clean up chunk file
            try {
              await Deno.remove(chunkFileName);
            } catch {}

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // Combine all transcripts
          transcriptionText = transcripts.join(' ');
          console.log(`Combined transcript: ${transcriptionText.length} characters`);
        }

        // Clean up audio file
        try {
          await Deno.remove(audioFileName);
        } catch {}

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