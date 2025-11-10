import { useState, useEffect } from "react";
import { SearchBar } from "@/components/SearchBar";
import { StatsCard } from "@/components/StatsCard";
import { VideoCard } from "@/components/VideoCard";
import { SearchResults } from "@/components/SearchResults";
import { ChatInterface } from "@/components/ChatInterface";
import { Database, Clock, FileText, Youtube, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [stats, setStats] = useState({
    totalVideos: 0,
    uhMentions: 0,
    lastUpdated: "Loading..."
  });
  const [recentVideos, setRecentVideos] = useState<any[]>([]);
  const { toast } = useToast();
  const { results: searchResults, isSearching, search } = useSemanticSearch();

  // Load stats and recent videos on mount
  useEffect(() => {
    loadStats();
    loadRecentVideos();
  }, []);

  const loadStats = async () => {
    try {
      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id, status, updated_at');

      if (!videosError && videos) {
        const latestUpdate = videos.length > 0 
          ? Math.max(...videos.map(v => new Date(v.updated_at).getTime()))
          : Date.now();
        
        const hoursAgo = Math.floor((Date.now() - latestUpdate) / (1000 * 60 * 60));
        const timeString = hoursAgo < 1 ? 'Just now' : 
                          hoursAgo < 24 ? `${hoursAgo} hrs ago` :
                          `${Math.floor(hoursAgo / 24)} days ago`;
        
        setStats({
          totalVideos: videos.length,
          uhMentions: videos.filter(v => v.status === 'processed').length,
          lastUpdated: videos.length > 0 ? timeString : 'Never'
        });
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadRecentVideos = async () => {
    try {
      const { data: videos, error } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          url,
          published_at,
          status,
          youtube_channels (channel_name)
        `)
        .order('published_at', { ascending: false })
        .limit(5);

      if (!error && videos) {
        setRecentVideos(videos.map(v => ({
          id: v.id,
          title: v.title,
          channel: (v.youtube_channels as any)?.channel_name || 'Unknown',
          date: new Date(v.published_at).toLocaleDateString(),
          url: v.url,
          status: v.status
        })));
      }
    } catch (error) {
      console.error('Error loading recent videos:', error);
    }
  };

  const handleSearch = async () => {
    setHasSearched(true);
    await search(searchQuery);
    
    toast({
      title: "Search completed",
      description: `Found ${searchResults.length} results for "${searchQuery}"`,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-hero">
              <Youtube className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Legislative Content Analysis
              </h1>
              <p className="text-sm text-muted-foreground">
                RAG-powered search for UH-related content
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total Videos"
            value={stats.totalVideos.toString()}
            icon={Database}
            description="Indexed videos"
          />
          <StatsCard
            title="Last Updated"
            value={stats.lastUpdated}
            icon={Clock}
            description="Most recent sync"
          />
          <StatsCard
            title="Processed"
            value={stats.uhMentions.toString()}
            icon={FileText}
            description="Ready to search"
          />
          <StatsCard
            title="Channels"
            value="2"
            icon={Youtube}
            description="Monitored sources"
          />
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="search" className="space-y-6">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Keyword Search
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              AI Chat
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-6">
            <div className="text-center space-y-4 py-8">
              <h2 className="text-3xl font-bold text-foreground">
                Search Legislative Content
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Search through transcribed legislative sessions from Senate Hawaii and House of Representatives
                for mentions and discussions about the University of Hawaii system
              </p>
            </div>
            
            <div className="flex justify-center">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                isLoading={isSearching}
              />
            </div>

            {hasSearched ? (
              <SearchResults results={searchResults} query={searchQuery} />
            ) : (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-foreground">
                    Recently Processed Videos
                  </h2>
                </div>
                <div className="grid gap-4">
                  {recentVideos.map((video) => (
                    <VideoCard key={video.id} {...video} />
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="chat" className="space-y-6">
            <div className="text-center space-y-4 py-8">
              <h2 className="text-3xl font-bold text-foreground">
                AI-Powered Legislative Assistant
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Ask questions about UH mentions in legislative sessions. The AI will analyze transcripts 
                and provide detailed answers with source citations.
              </p>
            </div>
            
            <div className="max-w-4xl mx-auto">
              <ChatInterface />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card mt-16">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Automated monitoring of legislative content • Updated continuously</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
