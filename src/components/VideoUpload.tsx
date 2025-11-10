import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const VideoUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
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

      // Get a channel to associate with (just grab the first one)
      const { data: channelData } = await supabase
        .from('youtube_channels')
        .select('id')
        .limit(1)
        .single();

      // Insert video metadata into database
      const { error: dbError } = await supabase
        .from('videos')
        .insert({
          title,
          description,
          url: publicUrl,
          youtube_id: fileName, // Using filename as unique ID
          published_at: new Date().toISOString(),
          status: 'pending',
          channel_id: channelData?.id || null
        });

      if (dbError) throw dbError;

      toast({
        title: "Video uploaded successfully!",
        description: "The video will be processed when you run the pipeline.",
      });

      // Reset form
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

  return (
    <Card className="p-6 bg-gradient-card border-border">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Upload Custom Video</h3>
          <p className="text-sm text-muted-foreground">
            Upload your own video to transcribe and add to the searchable database
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Video Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter video title"
              disabled={isUploading}
            />
          </div>

          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
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
            onClick={handleUpload}
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
        </div>
      </div>
    </Card>
  );
};