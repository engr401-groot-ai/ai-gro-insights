import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SearchResult {
  id: string;
  videoTitle: string;
  channel: string;
  date: string;
  url: string;
  excerpt: string;
  relevanceScore: number;
  timestamp?: string;
}

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
}

export const SearchResults = ({ results, query }: SearchResultsProps) => {
  if (results.length === 0) {
    return (
      <Card className="p-12 text-center bg-gradient-card border-border">
        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No results found</h3>
        <p className="text-muted-foreground">
          Try different keywords or check back later as more content is processed
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">
          Search Results for "<span className="text-primary">{query}</span>"
        </h2>
        <Badge variant="secondary" className="text-sm">
          {results.length} {results.length === 1 ? "result" : "results"}
        </Badge>
      </div>
      
      <div className="space-y-4">
        {results.map((result) => (
          <Card 
            key={result.id} 
            className="p-6 bg-gradient-card shadow-md hover:shadow-lg transition-all border-border group"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                    {result.videoTitle}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                    <span className="font-medium">{result.channel}</span>
                    <span>•</span>
                    <span>{result.date}</span>
                    {result.timestamp && (
                      <>
                        <span>•</span>
                        <span className="text-primary font-medium">{result.timestamp}</span>
                      </>
                    )}
                  </div>
                </div>
                
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:bg-primary/10 hover:text-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(result.url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              
              <p className="text-foreground leading-relaxed bg-muted/50 p-4 rounded-lg border border-border">
                {result.excerpt}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
