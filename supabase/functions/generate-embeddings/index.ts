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

    console.log(`Generating embeddings for video ID: ${videoId}`);

    // Get all segments for this video that don't have embeddings
    const { data: segments, error: segmentsError } = await supabase
      .from('transcript_segments')
      .select('*')
      .eq('video_id', videoId)
      .is('embedding', null);

    if (segmentsError) {
      throw segmentsError;
    }

    if (!segments || segments.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No segments need embeddings',
          processedCount: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${segments.length} segments`);
    let processedCount = 0;

    // Process in batches to avoid rate limits
    const batchSize = 20;
    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const texts = batch.map(s => s.segment_text);

      // Generate embeddings using OpenAI
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: texts,
        }),
      });

      if (!embeddingResponse.ok) {
        const errorText = await embeddingResponse.text();
        console.error('OpenAI API error:', embeddingResponse.status, errorText);
        throw new Error(`OpenAI API error (${embeddingResponse.status}): ${errorText}`);
      }

      const embeddingData = await embeddingResponse.json();
      console.log(`Received ${embeddingData.data?.length || 0} embeddings from OpenAI`);

      // Update each segment with its embedding
      for (let j = 0; j < batch.length; j++) {
        const segment = batch[j];
        const embedding = embeddingData.data[j].embedding;

        console.log(`Updating segment ${segment.id} with embedding (${embedding.length} dimensions)`);

        const { data: updateData, error: updateError } = await supabase
          .from('transcript_segments')
          .update({ embedding })
          .eq('id', segment.id)
          .select();

        if (updateError) {
          console.error(`Error updating segment ${segment.id}:`, updateError);
          throw updateError;
        }

        if (!updateData || updateData.length === 0) {
          console.error(`No rows updated for segment ${segment.id}`);
          throw new Error(`Failed to update segment ${segment.id}`);
        }

        console.log(`Successfully updated segment ${segment.id}`);
        processedCount++;
      }

      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}, total: ${processedCount}`);
      
      // Small delay to avoid rate limits
      if (i + batchSize < segments.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update video status to show it's fully processed
    await supabase
      .from('videos')
      .update({ status: 'completed' })
      .eq('id', videoId);

    console.log(`Embeddings generation completed. Processed ${processedCount} segments`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processedCount,
        totalSegments: segments.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-embeddings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
