import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Video, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const VideoUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check file size (500MB limit)
      if (selectedFile.size > 524288000) {
        toast({
          title: "File too large",
          description: "Please select a video under 500MB",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleUpload = async () => {
    if (!file || !title) {
      toast({
        title: "Missing information",
        description: "Please select a video and provide a title",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      // Upload video to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('user-videos')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('user-videos')
        .getPublicUrl(filePath);

      // Create video record
      const { data: video, error: videoError } = await supabase
        .from('videos')
        .insert({
          title: title,
          description: 'User uploaded video',
          url: publicUrl,
          youtube_id: `custom-${fileName}`,
          published_at: new Date().toISOString(),
          status: 'pending',
          channel_id: null
        })
        .select()
        .single();

      if (videoError) throw videoError;

      toast({
        title: "Video uploaded successfully!",
        description: "The video will be processed shortly. Check back soon.",
      });

      // Reset form
      setFile(null);
      setTitle("");
      if (document.querySelector('input[type="file"]')) {
        (document.querySelector('input[type="file"]') as HTMLInputElement).value = '';
      }

    } catch (error) {
      console.error('Error uploading video:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload video",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-6 bg-gradient-card border-border">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Upload Video</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="video-file">Video File (MP4, MOV, AVI, WebM - Max 500MB)</Label>
            <Input
              id="video-file"
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </div>

          {file && (
            <div className="space-y-2">
              <Label htmlFor="video-title">Video Title</Label>
              <Input
                id="video-title"
                type="text"
                placeholder="Enter video title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
              />
            </div>
          )}

          {file && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Video className="h-4 w-4" />
              <span>{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={!file || !title || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Video
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          After upload, the video will be transcribed and indexed for search. This may take several minutes depending on video length.
        </p>
      </div>
    </Card>
  );
};
