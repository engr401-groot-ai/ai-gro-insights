import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TranscriptViewerProps {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TranscriptViewer({ videoId, videoTitle, videoUrl, open, onOpenChange }: TranscriptViewerProps) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && !transcript) {
      loadTranscript();
    }
  }, [open, videoId]);

  const loadTranscript = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('transcriptions')
        .select('full_text')
        .eq('video_id', videoId)
        .single();

      if (error) throw error;

      setTranscript(data.full_text);
    } catch (error) {
      console.error('Error loading transcript:', error);
      toast({
        title: 'Error',
        description: 'Failed to load transcript',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${videoTitle.replace(/[^a-z0-9]/gi, '_')}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Success',
      description: 'Transcript downloaded',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span className="truncate">{videoTitle}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(videoUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Watch
              </Button>
              {transcript && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadTranscript}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-full pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : transcript ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p className="whitespace-pre-wrap text-foreground leading-relaxed">
                {transcript}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No transcript available
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
