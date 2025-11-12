import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  ArrowLeft, 
  Search, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock,
  FileText,
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Video {
  id: string;
  youtube_id: string;
  title: string;
  status: string;
  error_reason: string | null;
  transcript_id: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  created_at: string;
  duration: number | null;
}

interface VideoWithStats extends Video {
  segment_count?: number;
  transcription_length?: number;
}

export default function TranscriptionStatus() {
  const [videos, setVideos] = useState<VideoWithStats[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoWithStats[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchVideos();
    
    // Real-time subscription
    const channel = supabase
      .channel('transcription-status-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'videos'
        },
        () => {
          fetchVideos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    applyFilters();
  }, [videos, searchQuery, statusFilter]);

  const fetchVideos = async () => {
    setIsLoading(true);
    try {
      // Fetch videos with transcription stats
      const { data: videosData, error: videosError } = await supabase
        .from('videos')
        .select('*')
        .order('created_at', { ascending: false });

      if (videosError) throw videosError;

      // Fetch segment counts for each video
      const videosWithStats: VideoWithStats[] = await Promise.all(
        (videosData || []).map(async (video) => {
          const { count: segmentCount } = await supabase
            .from('transcript_segments')
            .select('*', { count: 'exact', head: true })
            .eq('video_id', video.id);

          const { data: transcription } = await supabase
            .from('transcriptions')
            .select('full_text')
            .eq('video_id', video.id)
            .maybeSingle();

          return {
            ...video,
            segment_count: segmentCount || 0,
            transcription_length: transcription?.full_text?.length || 0
          };
        })
      );

      setVideos(videosWithStats);
    } catch (error) {
      console.error('Error fetching videos:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch videos',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...videos];

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(v => v.status === statusFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v => 
        v.title.toLowerCase().includes(query) ||
        v.youtube_id.toLowerCase().includes(query) ||
        v.error_reason?.toLowerCase().includes(query)
      );
    }

    setFilteredVideos(filtered);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      processing: 'secondary',
      failed: 'destructive',
      pending: 'outline',
    };

    return (
      <Badge variant={variants[status] || 'outline'} className="gap-1">
        {getStatusIcon(status)}
        {status}
      </Badge>
    );
  };

  const calculateProcessingTime = (video: VideoWithStats) => {
    if (!video.processing_started_at) return 'N/A';
    
    const startTime = new Date(video.processing_started_at).getTime();
    const endTime = video.processing_completed_at 
      ? new Date(video.processing_completed_at).getTime()
      : Date.now();
    
    const diffMs = endTime - startTime;
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
    
    return `${minutes}m ${seconds}s`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const stats = {
    total: videos.length,
    pending: videos.filter(v => v.status === 'pending').length,
    processing: videos.filter(v => v.status === 'processing').length,
    completed: videos.filter(v => v.status === 'completed').length,
    failed: videos.filter(v => v.status === 'failed').length,
  };

  const triggerStatusCheck = async () => {
    try {
      toast({
        title: 'Checking Status',
        description: 'Manually triggering status check...',
      });

      const { data, error } = await supabase.functions.invoke('check-transcription-status');
      
      if (error) throw error;
      
      toast({
        title: 'Status Check Complete',
        description: `Checked: ${data.checked}, Completed: ${data.completed}, Failed: ${data.failed}`,
      });
      
      fetchVideos();
    } catch (error) {
      console.error('Error triggering status check:', error);
      toast({
        title: 'Error',
        description: 'Failed to check status',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Transcription Status</h1>
              <p className="text-muted-foreground">Monitor video transcription progress</p>
            </div>
          </div>
          <Button onClick={triggerStatusCheck} variant="outline">
            <Loader2 className="h-4 w-4 mr-2" />
            Check Status Now
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Videos</div>
          </Card>
          <Card className="p-4 border-yellow-500/20 bg-yellow-500/5">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {stats.pending}
            </div>
            <div className="text-sm text-yellow-600 dark:text-yellow-400">Pending</div>
          </Card>
          <Card className="p-4 border-blue-500/20 bg-blue-500/5">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
              {stats.processing}
              {stats.processing > 0 && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            <div className="text-sm text-blue-600 dark:text-blue-400">Processing</div>
          </Card>
          <Card className="p-4 border-green-500/20 bg-green-500/5">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.completed}
            </div>
            <div className="text-sm text-green-600 dark:text-green-400">Completed</div>
          </Card>
          <Card className="p-4 border-red-500/20 bg-red-500/5">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {stats.failed}
            </div>
            <div className="text-sm text-red-600 dark:text-red-400">Failed</div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, video ID, or error reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Videos Table */}
        <Card>
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Video Title</TableHead>
                  <TableHead>YouTube ID</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Segments</TableHead>
                  <TableHead>Processing Time</TableHead>
                  <TableHead>Transcript Size</TableHead>
                  <TableHead>Error Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVideos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No videos found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVideos.map((video) => (
                    <TableRow key={video.id}>
                      <TableCell>{getStatusBadge(video.status)}</TableCell>
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {video.title}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://youtube.com/watch?v=${video.youtube_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {video.youtube_id}
                        </a>
                      </TableCell>
                      <TableCell>{formatDuration(video.duration)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {video.segment_count || 0}
                        </div>
                      </TableCell>
                      <TableCell>{calculateProcessingTime(video)}</TableCell>
                      <TableCell>
                        {video.transcription_length 
                          ? `${(video.transcription_length / 1000).toFixed(1)}k chars`
                          : 'N/A'
                        }
                      </TableCell>
                      <TableCell>
                        {video.error_reason ? (
                          <Badge variant="destructive" className="text-xs">
                            {video.error_reason}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
