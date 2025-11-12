import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Keyword {
  id: string;
  keyword: string;
  description: string | null;
  created_at: string;
}

export const KeywordManager = () => {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const { toast } = useToast();

  const loadKeywords = async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKeywords();
  }, []);

  const handleAddKeyword = async () => {
    if (!newKeyword.trim()) {
      toast({
        title: "Keyword required",
        description: "Please enter a keyword",
        variant: "destructive",
      });
      return;
    }

    setIsAdding(true);
    try {
      const { error } = await supabase
        .from('search_keywords')
        .insert({
          keyword: newKeyword.trim(),
          description: newDescription.trim() || null,
        });

      if (error) throw error;

      toast({
        title: "Keyword added",
        description: `"${newKeyword}" has been added to the search keywords`,
      });

      setNewKeyword("");
      setNewDescription("");
      await loadKeywords();
    } catch (error) {
      console.error('Error adding keyword:', error);
      toast({
        title: "Failed to add keyword",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteKeyword = async (id: string, keyword: string) => {
    try {
      const { error } = await supabase
        .from('search_keywords')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Keyword removed",
        description: `"${keyword}" has been removed`,
      });

      await loadKeywords();
    } catch (error) {
      console.error('Error deleting keyword:', error);
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
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Manage Search Keywords</h3>
          <p className="text-sm text-muted-foreground">
            Add custom keywords to enhance search functionality
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="keyword">Keyword</Label>
            <Input
              id="keyword"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g., UH Manoa, Budget, Research"
              disabled={isAdding}
            />
          </div>

          <div>
            <Label htmlFor="keyword-description">Description (Optional)</Label>
            <Input
              id="keyword-description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Brief description of the keyword"
              disabled={isAdding}
            />
          </div>

          <Button
            onClick={handleAddKeyword}
            disabled={!newKeyword.trim() || isAdding}
            className="w-full"
          >
            {isAdding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add Keyword
              </>
            )}
          </Button>
        </div>

        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">
            Active Keywords ({keywords.length})
          </h4>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keywords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No keywords added yet
            </p>
          ) : (
            <ScrollArea className="h-[300px] pr-2">
              <div className="space-y-2">
                {keywords.map((kw) => (
                  <div
                    key={kw.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
                  >
                    <div className="flex-1">
                      <Badge variant="secondary" className="mb-1">
                        {kw.keyword}
                      </Badge>
                      {kw.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {kw.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteKeyword(kw.id, kw.keyword)}
                      className="hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </Card>
  );
};