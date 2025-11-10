import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Calendar, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoCardProps {
  title: string;
  channel: string;
  date: string;
  url: string;
  status: "processed" | "processing" | "pending";
  relevanceScore?: number;
}

export const VideoCard = ({ 
  title, 
  channel, 
  date, 
  url, 
  status,
  relevanceScore 
}: VideoCardProps) => {
  const statusColors = {
    processed: "bg-accent/20 text-accent border-accent/30",
    processing: "bg-primary/20 text-primary border-primary/30",
    pending: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Card className="p-5 bg-gradient-card shadow-md hover:shadow-lg transition-all border-border group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 mt-1">
              <Video className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
                {title}
              </h3>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="font-medium">{channel}</span>
                <div className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{date}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={statusColors[status]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
            {relevanceScore !== undefined && (
              <span className="text-sm text-muted-foreground">
                Relevance: <span className="font-medium text-foreground">{relevanceScore}%</span>
              </span>
            )}
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-primary/10 hover:text-primary"
          onClick={(e) => {
            e.preventDefault();
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};
