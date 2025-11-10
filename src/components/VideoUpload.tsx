import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Loader2, Link } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const VideoUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const extractYoutubeId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const handleFileUpload = async () => {
    if (!file || !title) {
      toast({
        title: "Missing information",
        description: "Please provide both a video file and a title",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('user-videos')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('user-videos')
        .getPublicUrl(filePath);

      const { data: channelData } = await supabase
        .from('youtube_channels')
        .select('id')
        .limit(1)
        .single();

      const { error: dbError } = await supabase
        .from('videos')
        .insert({
          title,
          description,
          url: publicUrl,
          youtube_id: fileName,
          published_at: new Date().toISOString(),
          status: 'pending',
          channel_id: channelData?.id || null
        });

      if (dbError) throw dbError;

      toast({
        title: "Video uploaded successfully!",
        description: "Run the pipeline in Admin Panel to transcribe it.",
      });

      setFile(null);
      setTitle("");
      setDescription("");
      (document.getElementById('video-file') as HTMLInputElement).value = '';
      
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload video",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleYoutubeUpload = async () => {
    if (!youtubeUrl || !title) {
      toast({
        title: "Missing information",
        description: "Please provide both a YouTube URL and a title",
        variant: "destructive",
      });
      return;
    }

    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) {
      toast({
        title: "Invalid URL",
        description: "Please provide a valid YouTube URL or video ID",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const { data: channelData } = await supabase
        .from('youtube_channels')
        .select('id')
        .limit(1)
        .single();

      const videoUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
      const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;

      const { error: dbError } = await supabase
        .from('videos')
        .insert({
          title,
          description,
          url: videoUrl,
          youtube_id: youtubeId,
          thumbnail_url: thumbnailUrl,
          published_at: new Date().toISOString(),
          status: 'pending',
          channel_id: channelData?.id || null
        });

      if (dbError) throw dbError;

      toast({
        title: "YouTube video added successfully!",
        description: "Run the pipeline in Admin Panel to transcribe it.",
      });

      setYoutubeUrl("");
      setTitle("");
      setDescription("");
      
    } catch (error) {
      console.error('YouTube upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to add YouTube video",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="p-6 bg-gradient-card border-border">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Add Custom Video</h3>
          <p className="text-sm text-muted-foreground">
            Upload a video file or add a YouTube video to transcribe and search
          </p>
        </div>

        <Tabs defaultValue="youtube" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="youtube">YouTube URL</TabsTrigger>
            <TabsTrigger value="file">Upload File</TabsTrigger>
          </TabsList>

          <TabsContent value="youtube" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="youtube-url">YouTube URL or Video ID</Label>
              <Input
                id="youtube-url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... or video ID"
                disabled={isUploading}
              />
            </div>

            <div>
              <Label htmlFor="yt-title">Video Title</Label>
              <Input
                id="yt-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter video title"
                disabled={isUploading}
              />
            </div>

            <div>
              <Label htmlFor="yt-description">Description (Optional)</Label>
              <Input
                id="yt-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter video description"
                disabled={isUploading}
              />
            </div>

            <Button
              onClick={handleYoutubeUpload}
              disabled={!youtubeUrl || !title || isUploading}
              className="w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Link className="mr-2 h-4 w-4" />
                  Add YouTube Video
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="file" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="file-title">Video Title</Label>
              <Input
                id="file-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter video title"
                disabled={isUploading}
              />
            </div>

            <div>
              <Label htmlFor="file-description">Description (Optional)</Label>
              <Input
                id="file-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter video description"
                disabled={isUploading}
              />
            </div>

            <div>
              <Label htmlFor="video-file">Video File (MP4, MOV, AVI, WebM - Max 500MB)</Label>
              <Input
                id="video-file"
                type="file"
                accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
                onChange={handleFileChange}
                disabled={isUploading}
              />
              {file && (
                <p className="text-sm text-muted-foreground mt-1">
                  Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>

            <Button
              onClick={handleFileUpload}
              disabled={!file || !title || isUploading}
              className="w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Video
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  );
};