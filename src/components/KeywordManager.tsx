import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Keyword {
  id: string;
  keyword: string;
  description: string | null;
  is_active: boolean;
}

export const KeywordManager = () => {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadKeywords();
  }, []);

  const loadKeywords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('search_keywords')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setKeywords(data || []);
    } catch (error) {
      console.error('Error loading keywords:', error);
      toast({
        title: "Failed to load keywords",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = async () => {
    if (!newKeyword.trim()) {
      toast({
        title: "Missing keyword",
        description: "Please enter a keyword",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase
        .from('search_keywords')
        .insert({
          keyword: newKeyword.trim(),
          description: newDescription.trim() || null,
        });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: "Keyword already exists",
            description: "This keyword is already in the database",
            variant: "destructive",
          });
        } else {
          throw error;
        }
        return;
      }

      toast({
        title: "Keyword added",
        description: `"${newKeyword}" has been added to the search keywords`,
      });

      setNewKeyword("");
      setNewDescription("");
      loadKeywords();
    } catch (error) {
      console.error('Error adding keyword:', error);
      toast({
        title: "Failed to add keyword",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveKeyword = async (id: string, keyword: string) => {
    try {
      const { error } = await supabase
        .from('search_keywords')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Keyword removed",
        description: `"${keyword}" has been deactivated`,
      });

      loadKeywords();
    } catch (error) {
      console.error('Error removing keyword:', error);
      toast({
        title: "Failed to remove keyword",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="p-6 bg-gradient-card border-border">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Manage Keywords</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="keyword">New Keyword</Label>
            <Input
              id="keyword"
              type="text"
              placeholder="e.g., UH Manoa, budget allocation"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              disabled={adding}
              onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
              type="text"
              placeholder="Brief description of what to search for"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              disabled={adding}
            />
          </div>

          <Button
            onClick={handleAddKeyword}
            disabled={!newKeyword.trim() || adding}
            className="w-full"
          >
            {adding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add Keyword
              </>
            )}
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Active Keywords ({keywords.length})</Label>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : keywords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No keywords yet. Add your first keyword above!
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw) => (
                <Badge
                  key={kw.id}
                  variant="secondary"
                  className="flex items-center gap-1 px-3 py-1.5"
                >
                  <span>{kw.keyword}</span>
                  <button
                    onClick={() => handleRemoveKeyword(kw.id, kw.keyword)}
                    className="ml-1 hover:text-destructive transition-colors"
                    aria-label={`Remove ${kw.keyword}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Keywords help organize and filter search results. They're also useful for tracking specific topics in legislative sessions.
        </p>
      </div>
    </Card>
  );
};
