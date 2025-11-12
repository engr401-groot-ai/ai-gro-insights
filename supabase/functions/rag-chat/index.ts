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

    const { message, conversationId } = await req.json();
    
    if (!message) {
      throw new Error('Message is required');
    }
    
    // Validate message length
    if (message.length < 3 || message.length > 1000) {
      return new Response(
        JSON.stringify({ error: 'Message must be between 3 and 1000 characters' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Processing RAG chat message: "${message}"`);

    // Get or create conversation
    let currentConversationId = conversationId;
    if (!currentConversationId) {
      const { data: newConversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .insert({ user_id: user.id })
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

    // Search for relevant content (segments and full transcripts)
    const { data: relevantContent, error: searchError } = await supabase
      .rpc('search_transcripts_and_segments', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 10
      });

    if (searchError) {
      console.error('Search error:', searchError);
      throw searchError;
    }

    console.log(`Found ${relevantContent?.length || 0} relevant items`);

    // Deduplicate results by video - keep only the most relevant result per video
    const uniqueByVideo = new Map();
    relevantContent?.forEach((item: any) => {
      const existing = uniqueByVideo.get(item.video_id);
      if (!existing || item.similarity > existing.similarity) {
        uniqueByVideo.set(item.video_id, item);
      }
    });
    const deduplicatedContent = Array.from(uniqueByVideo.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5); // Limit to top 5 unique videos

    console.log(`After deduplication: ${deduplicatedContent.length} unique videos`);

    // Build context from relevant content
    const context = deduplicatedContent?.map((item: any) => {
      if (item.is_full_transcript) {
        return `[Full Transcript - Video: "${item.video_title}" from ${item.channel_name}, ${new Date(item.published_at).toLocaleDateString()}]\n${item.content_text.substring(0, 1000)}${item.content_text.length > 1000 ? '...' : ''}`;
      } else {
        return `[Video: "${item.video_title}" from ${item.channel_name}, ${new Date(item.published_at).toLocaleDateString()}]\n${item.content_text}\n(at ${formatTime(item.start_time)})`;
      }
    }).join('\n\n') || 'No relevant information found.';

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
        temperature: 0,
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
        sources: deduplicatedContent?.map((item: any) => ({
          videoTitle: item.video_title,
          channel: item.channel_name,
          url: item.video_url,
          timestamp: item.start_time,
          publishedAt: item.published_at,
          similarity: item.similarity,
          segmentText: item.content_text,
          startTime: item.start_time,
          endTime: item.end_time,
          isFullTranscript: item.is_full_transcript
        }))
      });

    console.log('RAG chat response generated successfully');

    return new Response(
      JSON.stringify({ 
        success: true,
        conversationId: currentConversationId,
        response: assistantMessage,
        sources: deduplicatedContent?.map((item: any) => ({
          videoTitle: item.video_title,
          channel: item.channel_name,
          url: item.video_url,
          timestamp: item.is_full_transcript ? 'Full Transcript' : formatTime(item.start_time),
          publishedAt: item.published_at,
          similarity: Math.round(item.similarity * 100),
          segmentText: item.content_text,
          startTime: item.start_time,
          endTime: item.end_time,
          isFullTranscript: item.is_full_transcript
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
