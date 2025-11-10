import { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Download, FileText, Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const AdminPanel = () => {
  const [isFetching, setIsFetching] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);
  const { toast } = useToast();

  const runFullPipeline = async () => {
    setIsFetching(true);
    setIsTranscribing(true);
    setIsGeneratingEmbeddings(true);
    
    try {
      toast({
        title: 'Pipeline Started',
        description: 'Running full automated pipeline. This may take a few minutes...',
      });

      const { data, error } = await supabase.functions.invoke('pipeline-orchestrator');
      
      if (error) throw error;
      
      const results = data.results;
      
      toast({
        title: 'Pipeline Complete! 🎉',
        description: `Fetched: ${results.videosFetched}, Transcribed: ${results.videosTranscribed}, Embeddings: ${results.embeddingsGenerated}`,
      });

      if (results.errors.length > 0) {
        console.warn('Pipeline errors:', results.errors);
        toast({
          title: 'Some Errors Occurred',
          description: `${results.errors.length} errors. Check console for details.`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error running pipeline:', error);
      toast({
        title: 'Pipeline Error',
        description: 'Failed to run pipeline. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsFetching(false);
      setIsTranscribing(false);
      setIsGeneratingEmbeddings(false);
    }
  };

  const fetchVideos = async () => {
    setIsFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-youtube-videos');
      
      if (error) throw error;
      
      toast({
        title: 'Videos Fetched!',
        description: `Successfully fetched ${data.totalNewVideos} new videos from YouTube`,
      });
    } catch (error) {
      console.error('Error fetching videos:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch videos. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsFetching(false);
    }
  };

  const transcribeVideos = async () => {
    setIsTranscribing(true);
    try {
      // Get all pending videos
      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id')
        .eq('status', 'pending')
        .limit(5); // Process 5 at a time

      if (videosError) throw videosError;

      if (!videos || videos.length === 0) {
        toast({
          title: 'No Videos to Process',
          description: 'All videos have been transcribed or there are no videos yet.',
        });
        setIsTranscribing(false);
        return;
      }

      // Transcribe each video
      for (const video of videos) {
        await supabase.functions.invoke('transcribe-video', {
          body: { videoId: video.id }
        });
      }

      toast({
        title: 'Transcription Complete!',
        description: `Successfully transcribed ${videos.length} videos`,
      });
    } catch (error) {
      console.error('Error transcribing videos:', error);
      toast({
        title: 'Error',
        description: 'Failed to transcribe videos. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const generateEmbeddings = async () => {
    setIsGeneratingEmbeddings(true);
    try {
      // Get all transcribed videos
      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id')
        .eq('status', 'transcribed')
        .limit(5); // Process 5 at a time

      if (videosError) throw videosError;

      if (!videos || videos.length === 0) {
        toast({
          title: 'No Videos to Process',
          description: 'All videos have embeddings or need to be transcribed first.',
        });
        setIsGeneratingEmbeddings(false);
        return;
      }

      // Generate embeddings for each video
      for (const video of videos) {
        await supabase.functions.invoke('generate-embeddings', {
          body: { videoId: video.id }
        });
      }

      toast({
        title: 'Embeddings Generated!',
        description: `Successfully generated embeddings for ${videos.length} videos`,
      });
    } catch (error) {
      console.error('Error generating embeddings:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate embeddings. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingEmbeddings(false);
    }
  };

  return (
    <Card className="p-6 space-y-4 bg-gradient-card border-2 border-primary/20">
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">Data Pipeline Controls</h3>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">🤖 Automated Pipeline</p>
              <p className="text-sm text-muted-foreground">
                Runs every 6 hours automatically. Or click to run now:
              </p>
            </div>
            <Button
              onClick={runFullPipeline}
              disabled={isFetching || isTranscribing || isGeneratingEmbeddings}
              className="gap-2"
            >
              {(isFetching || isTranscribing || isGeneratingEmbeddings) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run Full Pipeline
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Or run steps individually:
          </p>

          <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              1
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Fetch Videos from YouTube</p>
              <p className="text-xs text-muted-foreground">Download latest videos from monitored channels</p>
            </div>
            <Button
              onClick={fetchVideos}
              disabled={isFetching}
              size="sm"
              className="gap-2"
            >
              {isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Fetch
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              2
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Transcribe Videos</p>
              <p className="text-xs text-muted-foreground">Convert audio to text using OpenAI Whisper (real transcription when yt-dlp available)</p>
            </div>
            <Button
              onClick={transcribeVideos}
              disabled={isTranscribing}
              size="sm"
              variant="secondary"
              className="gap-2"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Transcribe
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              3
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Generate Embeddings</p>
              <p className="text-xs text-muted-foreground">Create AI embeddings for semantic search</p>
            </div>
            <Button
              onClick={generateEmbeddings}
              disabled={isGeneratingEmbeddings}
              size="sm"
              variant="secondary"
              className="gap-2"
            >
              {isGeneratingEmbeddings ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate
                </>
              )}
            </Button>
          </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              System automatically fetches, transcribes, and indexes videos every 6 hours (12am, 6am, 12pm, 6pm).
              Transcription attempts to use real YouTube audio via yt-dlp + OpenAI Whisper. Falls back to mock data if yt-dlp is unavailable.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};
