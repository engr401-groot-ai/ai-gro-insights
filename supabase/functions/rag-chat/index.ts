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
    const { message, conversationId } = await req.json();
    
    if (!message) {
      throw new Error('Message is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing RAG chat message: "${message}"`);

    // Get or create conversation
    let currentConversationId = conversationId;
    if (!currentConversationId) {
      const { data: newConversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .insert({ user_id: 'anonymous' })
        .select()
        .single();

      if (conversationError) {
        throw conversationError;
      }
      currentConversationId = newConversation.id;
    }

    // Save user message
    await supabase
      .from('chat_messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'user',
        content: message
      });

    // Generate embedding for the message
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: message,
      }),
    });

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Search for relevant segments
    const { data: relevantSegments, error: searchError } = await supabase
      .rpc('search_transcript_segments', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 5
      });

    if (searchError) {
      console.error('Search error:', searchError);
      throw searchError;
    }

    console.log(`Found ${relevantSegments?.length || 0} relevant segments`);

    // Build context from relevant segments
    const context = relevantSegments?.map((seg: any) => 
      `[Video: "${seg.video_title}" from ${seg.channel_name}, ${new Date(seg.published_at).toLocaleDateString()}]\n${seg.segment_text}\n(at ${formatTime(seg.start_time)})`
    ).join('\n\n') || 'No relevant information found.';

    // Get conversation history
    const { data: history } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', currentConversationId)
      .order('created_at', { ascending: true })
      .limit(10);

    const messages = [
      {
        role: 'system',
        content: `You are an AI assistant helping Stephanie analyze legislative content from Hawaii's Senate and House of Representatives. Your role is to answer questions about mentions and discussions of the University of Hawaii (UH) system, particularly UH Manoa, based on transcriptions of legislative sessions.

When answering:
1. Always cite the video source, date, and timestamp
2. Be specific about what was discussed
3. If the context doesn't contain relevant information, say so clearly
4. Focus on UH-related content, especially UH Manoa
5. Summarize key points clearly

Context from legislative transcripts:
${context}`
      },
      ...(history || []).slice(-8) // Keep last 8 messages for context
    ];

    // Generate response using OpenAI
    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('OpenAI chat error:', errorText);
      throw new Error('Failed to generate response');
    }

    const chatData = await chatResponse.json();
    const assistantMessage = chatData.choices[0].message.content;

    // Save assistant response with sources
    await supabase
      .from('chat_messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'assistant',
        content: assistantMessage,
        sources: relevantSegments?.map((seg: any) => ({
          videoTitle: seg.video_title,
          channel: seg.channel_name,
          url: seg.video_url,
          timestamp: seg.start_time,
          publishedAt: seg.published_at,
          similarity: seg.similarity
        }))
      });

    console.log('RAG chat response generated successfully');

    return new Response(
      JSON.stringify({ 
        success: true,
        conversationId: currentConversationId,
        response: assistantMessage,
        sources: relevantSegments?.map((seg: any) => ({
          videoTitle: seg.video_title,
          channel: seg.channel_name,
          url: seg.video_url,
          timestamp: formatTime(seg.start_time),
          publishedAt: seg.published_at,
          similarity: Math.round(seg.similarity * 100)
        })) || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in rag-chat:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
