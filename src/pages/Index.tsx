import { useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { StatsCard } from "@/components/StatsCard";
import { VideoCard } from "@/components/VideoCard";
import { SearchResults } from "@/components/SearchResults";
import { Database, Clock, FileText, Youtube } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();

  // Mock data for demonstration
  const recentVideos = [
    {
      id: "1",
      title: "Senate Committee Hearing on Education Budget",
      channel: "Senate Hawaii",
      date: "2024-01-15",
      url: "https://youtube.com/watch?v=example1",
      status: "processed" as const,
      relevanceScore: 95,
    },
    {
      id: "2",
      title: "House Discussion on University Funding",
      channel: "House of Representatives",
      date: "2024-01-14",
      url: "https://youtube.com/watch?v=example2",
      status: "processed" as const,
      relevanceScore: 88,
    },
    {
      id: "3",
      title: "Legislative Session - State Budget Review",
      channel: "Senate Hawaii",
      date: "2024-01-13",
      url: "https://youtube.com/watch?v=example3",
      status: "processing" as const,
    },
  ];

  const handleSearch = async () => {
    setIsSearching(true);
    setHasSearched(true);
    
    // Simulate API call
    setTimeout(() => {
      const mockResults = [
        {
          id: "r1",
          videoTitle: "Senate Committee Hearing on Education Budget",
          channel: "Senate Hawaii",
          date: "2024-01-15",
          url: "https://youtube.com/watch?v=example1",
          excerpt: "The committee discussed the proposed budget allocation for the University of Hawaii system, highlighting the need for increased funding for research facilities and student support programs.",
          relevanceScore: 95,
          timestamp: "12:34",
        },
        {
          id: "r2",
          videoTitle: "House Discussion on University Funding",
          channel: "House of Representatives",
          date: "2024-01-14",
          url: "https://youtube.com/watch?v=example2",
          excerpt: "Representatives debated the impact of recent policy changes on UH Manoa's graduate programs and the importance of maintaining competitive funding for faculty recruitment.",
          relevanceScore: 88,
          timestamp: "45:12",
        },
      ];
      
      setSearchResults(mockResults);
      setIsSearching(false);
      
      toast({
        title: "Search completed",
        description: `Found ${mockResults.length} results for "${searchQuery}"`,
      });
    }, 1500);
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
            value="247"
            icon={Database}
            description="Processed videos"
          />
          <StatsCard
            title="Last Updated"
            value="2 hrs"
            icon={Clock}
            description="Ago"
          />
          <StatsCard
            title="UH Mentions"
            value="156"
            icon={FileText}
            description="Found references"
          />
          <StatsCard
            title="Channels"
            value="2"
            icon={Youtube}
            description="Monitored sources"
          />
        </div>

        {/* Search Section */}
        <section className="space-y-6">
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
        </section>

        {/* Search Results or Recent Videos */}
        {hasSearched ? (
          <section>
            <SearchResults results={searchResults} query={searchQuery} />
          </section>
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
