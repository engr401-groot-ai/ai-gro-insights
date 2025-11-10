import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Card } from './ui/card';
import { Send, Bot, User, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useRagChat } from '@/hooks/useRagChat';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

export const ChatInterface = () => {
  const [input, setInput] = useState('');
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, isLoading, sendMessage } = useRagChat();

  const toggleSource = (messageIdx: number, sourceIdx: number) => {
    const key = `${messageIdx}-${sourceIdx}`;
    setExpandedSources(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    await sendMessage(input);
    setInput('');
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Bot className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">AI Assistant</h3>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">Ask me anything about UH in legislative sessions</p>
            <p className="text-sm">Try: "Are there any bills about UH Manoa funding?"</p>
          </div>
        ) : (
          messages.map((message, idx) => (
            <div key={idx} className="space-y-2">
              <div className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div 
                  className={`rounded-lg px-4 py-2 max-w-[80%] ${
                    message.role === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
                {message.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-accent" />
                  </div>
                )}
              </div>
              
              {message.sources && message.sources.length > 0 && (
                <div className="ml-11 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Sources:</p>
                  {message.sources.map((source, sourceIdx) => {
                    const isExpanded = expandedSources[`${idx}-${sourceIdx}`];
                    return (
                      <Collapsible
                        key={sourceIdx}
                        open={isExpanded}
                        onOpenChange={() => toggleSource(idx, sourceIdx)}
                      >
                        <div className="border border-border rounded-lg overflow-hidden">
                          <div className="flex items-start gap-2 p-3 hover:bg-accent/5 transition-colors">
                            <ExternalLink className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm text-foreground truncate">
                                    {source.videoTitle}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {source.channel} • {new Date(source.publishedAt).toLocaleDateString()}
                                  </p>
                                  <p className="text-xs text-primary mt-1">
                                    At {source.timestamp} • {source.similarity}% relevant
                                  </p>
                                </div>
                                <CollapsibleTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 flex-shrink-0"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                              </div>
                            </div>
                          </div>
                          
                          <CollapsibleContent>
                            <div className="px-3 pb-3 pt-1 space-y-2 bg-muted/30">
                              <div className="text-xs">
                                <p className="font-medium text-foreground mb-1">Transcript Segment:</p>
                                <p className="text-muted-foreground leading-relaxed italic">
                                  "{source.segmentText}"
                                </p>
                              </div>
                              <a
                                href={`${source.url}&t=${source.startTime}s`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Watch at {source.timestamp}
                              </a>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary animate-pulse" />
            </div>
            <div className="bg-muted rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about UH mentions in legislative sessions..."
          className="flex-1 resize-none"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <Button 
          type="submit" 
          disabled={!input.trim() || isLoading}
          size="icon"
          className="self-end"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
};
