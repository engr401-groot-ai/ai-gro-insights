import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Download, FileText, Sparkles, CheckCircle2, Loader2, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { VideoUpload } from "@/components/VideoUpload";
import { KeywordManager } from "@/components/KeywordManager";
import { useNavigate } from 'react-router-dom';

export const AdminPanel = () => {
  const [isFetching, setIsFetching] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [videoStats, setVideoStats] = useState({
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  });
  const { toast } = useToast();
  const navigate = useNavigate();

  // Real-time subscription to track ALL video status changes (always active)
  useEffect(() => {
    // Initial load
    updateVideoStats();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('video-status-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'videos'
        },
        (payload) => {
          console.log('Video status changed:', payload);
          updateVideoStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateVideoStats = async () => {
    const { data: videos } = await supabase
      .from('videos')
      .select('status');

    if (videos) {
      setVideoStats({
        total: videos.length,
        pending: videos.filter(v => v.status === 'pending').length,
        processing: videos.filter(v => v.status === 'processing').length,
        completed: videos.filter(v => v.status === 'completed').length,
        failed: videos.filter(v => v.status === 'failed').length,
      });
    }
  };

  const runFullPipeline = async () => {
    setIsFetching(true);
    setIsTranscribing(true);
    setIsGeneratingEmbeddings(true);
    
    try {
      toast({
        title: 'Pipeline Started',
        description: 'Running full automated pipeline. This may take a few minutes...',
      });

      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('pipeline-orchestrator', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
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

      // Reload stats after pipeline completes
      setTimeout(() => {
        window.location.reload();
      }, 2000);
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
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('fetch-youtube-videos', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
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
    
    // Initialize progress tracking
    await updateVideoStats();
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Get all pending videos
      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id')
        .eq('status', 'pending')
        .limit(100); // Process up to 100 at a time

      if (videosError) throw videosError;

      if (!videos || videos.length === 0) {
        toast({
          title: 'No Videos to Process',
          description: 'All videos have been transcribed or there are no videos yet.',
        });
        setIsTranscribing(false);
        return;
      }

      // Process in batches of 5 to respect AssemblyAI's concurrent limit
      const BATCH_SIZE = 5;
      const BATCH_DELAY_MS = 2000; // 2 second delay between batches
      

      toast({
        title: 'Starting Transcription',
        description: `Processing ${videos.length} videos in batches of ${BATCH_SIZE}...`,
      });

      for (let i = 0; i < videos.length; i += BATCH_SIZE) {
        const batch = videos.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(videos.length / BATCH_SIZE);
        
        console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} videos)...`);
        
        // Process all videos in this batch concurrently
        await Promise.all(
          batch.map(video => 
            supabase.functions.invoke('start-transcription', {
              body: { videoId: video.id },
              headers: { Authorization: `Bearer ${session?.access_token}` }
            })
          )
        );
        
        // Wait before next batch (except for last batch)
        if (i + BATCH_SIZE < videos.length) {
          console.log(`Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      toast({
        title: 'Transcription Started!',
        description: `Initiated transcription for ${videos.length} videos. This will take some time.`,
      });
      
      // Final progress update
      await updateVideoStats();
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
      const { data: { session } } = await supabase.auth.getSession();
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
          body: { videoId: video.id },
          headers: { Authorization: `Bearer ${session?.access_token}` }
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

  const processAllPending = async () => {
    setIsProcessingAll(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Get ALL pending videos (no limit)
      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id, title')
        .eq('status', 'pending');

      if (videosError) throw videosError;

      if (!videos || videos.length === 0) {
        toast({
          title: 'No Pending Videos',
          description: 'All videos have been processed already.',
        });
        setIsProcessingAll(false);
        return;
      }

      toast({
        title: 'Processing Started',
        description: `Starting transcription for ${videos.length} videos. This will run in the background - you can close this page.`,
      });

      // Trigger transcription for all videos (they run in background)
      const promises = videos.map(video => 
        supabase.functions.invoke('start-transcription', {
          body: { videoId: video.id },
          headers: { Authorization: `Bearer ${session?.access_token}` }
        })
      );

      await Promise.all(promises);

      toast({
        title: 'Processing Triggered',
        description: `${videos.length} videos are now processing in the background. Check back later for results.`,
      });

      // Reload after a short delay to show updated status
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Error processing pending videos:', error);
      toast({
        title: 'Processing Error',
        description: 'Failed to start processing. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingAll(false);
    }
  };

  const batchGenerateAllEmbeddings = async () => {
    setIsBatchGenerating(true);
    try {
      toast({
        title: 'Batch Processing Started',
        description: 'Generating embeddings for all videos. This may take several minutes...',
      });

      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('batch-generate-embeddings', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      if (error) throw error;
      
      toast({
        title: 'Batch Processing Complete! 🎉',
        description: `Processed ${data.totalVideos} videos`,
      });

      // Reload after completion
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Error in batch processing:', error);
      toast({
        title: 'Batch Processing Error',
        description: 'Failed to process all videos. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsBatchGenerating(false);
    }
  };

  const retryFailedVideos = async () => {
    setIsRetrying(true);
    try {
      // Fetch all failed videos
      const { data: failedVideos, error: fetchError } = await supabase
        .from('videos')
        .select('id, title')
        .eq('status', 'failed')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      if (!failedVideos || failedVideos.length === 0) {
        toast({
          title: "No Failed Videos",
          description: "There are no failed videos to retry",
        });
        return;
      }

      toast({
        title: "Retry Started",
        description: `Retrying ${failedVideos.length} failed videos...`,
      });

      // Reset their status to pending first
      const { error: updateError } = await supabase
        .from('videos')
        .update({ status: 'pending' })
        .eq('status', 'failed');

      if (updateError) throw updateError;

      const { data: { session } } = await supabase.auth.getSession();

      // Process in batches of 5 with delay (respect AssemblyAI concurrency)
      const BATCH_SIZE = 5;
      const BATCH_DELAY_MS = 2000;
      
      for (let i = 0; i < failedVideos.length; i += BATCH_SIZE) {
        const batch = failedVideos.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(video =>
          supabase.functions.invoke('start-transcription', {
            body: { videoId: video.id },
            headers: { Authorization: `Bearer ${session?.access_token}` }
          })
        );

        await Promise.all(promises);

        // Wait before next batch (except for last batch)
        if (i + BATCH_SIZE < failedVideos.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      toast({
        title: "Retry Complete",
        description: `${failedVideos.length} videos queued for retry. Check progress above.`,
      });

      // Reload after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      console.error('Error retrying failed videos:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to retry videos",
        variant: "destructive",
      });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className="p-6 space-y-4 bg-gradient-card border-2 border-primary/20">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Admin Panel</h3>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate('/transcription-status')}
        >
          <BarChart3 className="h-4 w-4 mr-2" />
          View Detailed Status
        </Button>
      </div>

      {/* Real-time Video Processing Status */}
      {videoStats.total > 0 && (
        <div className="p-4 bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 border border-primary/30 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-foreground">Video Processing Status</h4>
            <span className="text-sm text-muted-foreground">Live Updates</span>
          </div>
          
          <div className="grid grid-cols-5 gap-2">
            <div className="p-3 bg-background/50 rounded-md text-center">
              <div className="text-2xl font-bold text-foreground">{videoStats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="p-3 bg-yellow-500/10 rounded-md text-center border border-yellow-500/20">
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{videoStats.pending}</div>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">Pending</div>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-md text-center border border-blue-500/20">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1">
                {videoStats.processing}
                {videoStats.processing > 0 && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400">Processing</div>
            </div>
            <div className="p-3 bg-green-500/10 rounded-md text-center border border-green-500/20">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{videoStats.completed}</div>
              <div className="text-xs text-green-600 dark:text-green-400">Completed</div>
            </div>
            <div className="p-3 bg-red-500/10 rounded-md text-center border border-red-500/20">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{videoStats.failed}</div>
              <div className="text-xs text-red-600 dark:text-red-400">Failed</div>
            </div>
          </div>

          {/* Progress Bar */}
          {videoStats.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Overall Progress</span>
                <span>{Math.round((videoStats.completed / videoStats.total) * 100)}% Complete</span>
              </div>
              <Progress 
                value={(videoStats.completed / videoStats.total) * 100} 
                className="h-2"
              />
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="upload">Upload Video</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 mt-4">
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
                <p className="text-xs text-muted-foreground">Convert audio to text using AssemblyAI (accepts YouTube URLs directly)</p>
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

          <div className="pt-4 border-t border-border space-y-4">
            <div className="p-4 bg-accent/10 border border-accent rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Generate Missing Embeddings</p>
                  <p className="text-sm text-muted-foreground">
                    Generate embeddings for completed videos (needed for search!)
                  </p>
                </div>
                <Button
                  onClick={batchGenerateAllEmbeddings}
                  disabled={isBatchGenerating}
                  variant="default"
                  className="gap-2"
                >
                  {isBatchGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Generate Embeddings
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">🔥 Process All Pending Videos</p>
                  <p className="text-sm text-muted-foreground">
                    Transcribe ALL pending videos at once (runs in background)
                  </p>
                </div>
                <Button
                  onClick={processAllPending}
                  disabled={isProcessingAll}
                  variant="default"
                  className="gap-2"
                >
                  {isProcessingAll ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Process All Pending
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">🔄 Retry Failed Videos</p>
                  <p className="text-sm text-muted-foreground">
                    Retry all failed transcriptions (resets status to pending)
                  </p>
                </div>
                <Button
                  onClick={retryFailedVideos}
                  disabled={isRetrying}
                  variant="outline"
                  className="gap-2"
                >
                  {isRetrying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Retry Failed
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Batch Generate Embeddings</p>
                  <p className="text-sm text-muted-foreground">
                    Generate embeddings for ALL videos that are missing them
                  </p>
                </div>
                <Button
                  onClick={batchGenerateAllEmbeddings}
                  disabled={isBatchGenerating}
                  variant="outline"
                  className="gap-2"
                >
                  {isBatchGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Batch Generate All
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
                Transcription uses AssemblyAI which accepts YouTube URLs directly for accurate, unlimited-length processing.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <VideoUpload />
        </TabsContent>

        <TabsContent value="keywords" className="mt-4">
          <KeywordManager />
        </TabsContent>
      </Tabs>
    </Card>
  );
};
