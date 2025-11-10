import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  isLoading?: boolean;
}

export const SearchBar = ({ value, onChange, onSearch, isLoading }: SearchBarProps) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) {
      onSearch();
    }
  };

  return (
    <div className="flex gap-3 w-full max-w-3xl">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          placeholder="Search for UH-related content in legislative sessions..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={handleKeyPress}
          className="pl-10 h-12 text-base bg-card border-border shadow-sm"
          disabled={isLoading}
        />
      </div>
      <Button 
        onClick={onSearch}
        disabled={isLoading || !value.trim()}
        size="lg"
        className="h-12 px-8 bg-gradient-hero hover:opacity-90 transition-opacity"
      >
        {isLoading ? "Searching..." : "Search"}
      </Button>
    </div>
  );
};
