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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Fetching YouTube channels...');
    
    // Get all channels from database
    const { data: channels, error: channelsError } = await supabase
      .from('youtube_channels')
      .select('*');

    if (channelsError) {
      console.error('Error fetching channels:', channelsError);
      throw channelsError;
    }

    let totalNewVideos = 0;

    for (const channel of channels || []) {
      console.log(`Fetching videos for channel: ${channel.channel_name}`);
      
      // Fetch videos from YouTube API
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channel.channel_id}&part=snippet&order=date&maxResults=50&type=video`
      );

      if (!response.ok) {
        console.error(`YouTube API error for channel ${channel.channel_name}:`, await response.text());
        continue;
      }

      const data = await response.json();

      for (const item of data.items || []) {
        const videoId = item.id.videoId;
        
        // Check if video already exists
        const { data: existing } = await supabase
          .from('videos')
          .select('id')
          .eq('youtube_id', videoId)
          .single();

        if (existing) {
          console.log(`Video ${videoId} already exists, skipping...`);
          continue;
        }

        // Get video details for duration
        const detailsResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoId}&part=contentDetails`
        );
        const detailsData = await detailsResponse.json();
        const duration = detailsData.items?.[0]?.contentDetails?.duration || 'PT0S';
        
        // Convert ISO 8601 duration to seconds
        const durationSeconds = convertISO8601ToSeconds(duration);

        // Insert new video
        const { error: insertError } = await supabase
          .from('videos')
          .insert({
            youtube_id: videoId,
            channel_id: channel.id,
            title: item.snippet.title,
            description: item.snippet.description,
            published_at: item.snippet.publishedAt,
            thumbnail_url: item.snippet.thumbnails?.high?.url,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            duration: durationSeconds,
            status: 'pending'
          });

        if (insertError) {
          console.error(`Error inserting video ${videoId}:`, insertError);
          continue;
        }

        totalNewVideos++;
        console.log(`Added new video: ${item.snippet.title}`);
      }

      // Update last sync time
      await supabase
        .from('youtube_channels')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', channel.id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Fetched ${totalNewVideos} new videos`,
        totalNewVideos 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetch-youtube-videos:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function convertISO8601ToSeconds(duration: string): number {
  const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  
  const hours = parseInt(matches[1] || '0');
  const minutes = parseInt(matches[2] || '0');
  const seconds = parseInt(matches[3] || '0');
  
  return hours * 3600 + minutes * 60 + seconds;
}
