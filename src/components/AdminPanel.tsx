import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Download, FileText, Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { VideoUpload } from "@/components/VideoUpload";
import { KeywordManager } from "@/components/KeywordManager";

export const AdminPanel = () => {
  const [isFetching, setIsFetching] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState({
    total: 0,
    completed: 0,
    processing: 0,
    failed: 0,
  });
  const { toast } = useToast();

  // Real-time subscription to track video status changes
  useEffect(() => {
    if (!isTranscribing) return;

    const channel = supabase
      .channel('video-status-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'videos'
        },
        (payload) => {
          console.log('Video status changed:', payload);
          updateProgressCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isTranscribing]);

  const updateProgressCounts = async () => {
    const { data: videos } = await supabase
      .from('videos')
      .select('status');

    if (videos) {
      setTranscriptionProgress({
        total: videos.length,
        completed: videos.filter(v => v.status === 'completed').length,
        processing: videos.filter(v => v.status === 'processing').length,
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
    await updateProgressCounts();
    
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
      
      // Set initial progress
      setTranscriptionProgress(prev => ({
        ...prev,
        total: videos.length,
      }));

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
            supabase.functions.invoke('transcribe-video', {
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
      await updateProgressCounts();
    } catch (error) {
      console.error('Error transcribing videos:', error);
      toast({
        title: 'Error',
        description: 'Failed to transcribe videos. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setIsTranscribing(false);
      // Reset progress after a delay
      setTimeout(() => {
        setTranscriptionProgress({ total: 0, completed: 0, processing: 0, failed: 0 });
      }, 5000);
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
        supabase.functions.invoke('transcribe-video', {
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

  return (
    <Card className="p-6 space-y-4 bg-gradient-card border-2 border-primary/20">
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">Admin Panel</h3>
      </div>

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

            {/* Progress Bar */}
            {isTranscribing && transcriptionProgress.total > 0 && (
              <div className="ml-11 mt-2 p-4 bg-muted/50 rounded-lg space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-foreground">Transcription Progress</span>
                  <span className="text-muted-foreground">
                    {transcriptionProgress.completed + transcriptionProgress.processing + transcriptionProgress.failed} / {transcriptionProgress.total}
                  </span>
                </div>
                <Progress 
                  value={((transcriptionProgress.completed + transcriptionProgress.failed) / transcriptionProgress.total) * 100} 
                  className="h-2"
                />
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    Completed: {transcriptionProgress.completed}
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    Processing: {transcriptionProgress.processing}
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    Failed: {transcriptionProgress.failed}
                  </span>
                </div>
              </div>
            )}

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
