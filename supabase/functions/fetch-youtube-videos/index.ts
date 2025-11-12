import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry with exponential backoff
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      
      // Handle rate limiting
      if (response.status === 429 || response.status === 403) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), retryAfter * 1000);
        
        console.warn(`Rate limited (${response.status}), retrying after ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      const backoffMs = 1000 * Math.pow(2, attempt);
      console.warn(`Request failed, retrying after ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries}):`, error);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

// Convert channel ID to uploads playlist ID
function getUploadsPlaylistId(channelId: string): string {
  // YouTube convention: replace 'UC' prefix with 'UU' to get uploads playlist
  return channelId.replace(/^UC/, 'UU');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log('Starting video discovery pipeline...');
    
    const { data: channels, error: channelsError } = await supabase
      .from('youtube_channels')
      .select('*');

    if (channelsError) {
      console.error('Error fetching channels:', channelsError);
      throw channelsError;
    }

    let totalNewVideos = 0;
    const errors: { channel: string; error: string }[] = [];

    for (const channel of channels || []) {
      console.log(`Processing channel: ${channel.channel_name} (${channel.channel_id})`);
      
      try {
        const uploadsPlaylistId = getUploadsPlaylistId(channel.channel_id);
        const lastSyncAt = channel.last_sync_at ? new Date(channel.last_sync_at) : null;
        
        let pageToken: string | null = null;
        let shouldContinue = true;
        const videoIds: string[] = [];
        
        // Paginate through playlist items
        while (shouldContinue) {
          const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?key=${youtubeApiKey}&playlistId=${uploadsPlaylistId}&part=snippet&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
          
          const response = await fetchWithRetry(playlistUrl);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`YouTube API error for channel ${channel.channel_name}:`, errorText);
            errors.push({ channel: channel.channel_name, error: errorText });
            break;
          }

          const data = await response.json();
          console.log(`Fetched ${data.items?.length || 0} playlist items for ${channel.channel_name}`);

          // Process items
          for (const item of data.items || []) {
            const videoId = item.snippet.resourceId.videoId;
            const publishedAt = new Date(item.snippet.publishedAt);
            
            // Checkpoint: stop if we've reached videos we've already processed
            if (lastSyncAt && publishedAt <= lastSyncAt) {
              console.log(`Reached checkpoint at ${publishedAt.toISOString()}, stopping pagination`);
              shouldContinue = false;
              break;
            }
            
            // Check if video already exists
            const { data: existing } = await supabase
              .from('videos')
              .select('id')
              .eq('youtube_id', videoId)
              .single();

            if (!existing) {
              videoIds.push(videoId);
            }
          }

          // Check for next page
          if (data.nextPageToken && shouldContinue) {
            pageToken = data.nextPageToken;
          } else {
            shouldContinue = false;
          }
        }

        // Batch fetch video details (up to 50 per request)
        if (videoIds.length > 0) {
          console.log(`Fetching details for ${videoIds.length} new videos...`);
          
          for (let i = 0; i < videoIds.length; i += 50) {
            const batch = videoIds.slice(i, i + 50);
            const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${batch.join(',')}&part=snippet,contentDetails`;
            
            const detailsResponse = await fetchWithRetry(detailsUrl);
            const detailsData = await detailsResponse.json();

            for (const video of detailsData.items || []) {
              const duration = video.contentDetails.duration;
              const durationSeconds = convertISO8601ToSeconds(duration);

              const { error: insertError } = await supabase
                .from('videos')
                .insert({
                  youtube_id: video.id,
                  channel_id: channel.id,
                  title: video.snippet.title,
                  description: video.snippet.description,
                  published_at: video.snippet.publishedAt,
                  thumbnail_url: video.snippet.thumbnails?.high?.url,
                  url: `https://www.youtube.com/watch?v=${video.id}`,
                  duration: durationSeconds,
                  status: 'pending'
                });

              if (insertError) {
                console.error(`Error inserting video ${video.id}:`, insertError);
                errors.push({ channel: channel.channel_name, error: `Insert failed for ${video.id}` });
              } else {
                totalNewVideos++;
                console.log(`✓ Added: ${video.snippet.title}`);
              }
            }
          }
        }

        // Update last sync time
        await supabase
          .from('youtube_channels')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('id', channel.id);
          
        console.log(`✓ Completed ${channel.channel_name}: ${videoIds.length} new videos`);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to process channel ${channel.channel_name}:`, errorMsg);
        errors.push({ channel: channel.channel_name, error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Fetched ${totalNewVideos} new videos`,
        totalNewVideos,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Fatal error in fetch-youtube-videos:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
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
