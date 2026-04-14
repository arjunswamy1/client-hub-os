import { useState, useRef, useEffect } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, Send, Sparkles, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';

interface Source {
  title: string;
  source: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
}

const SUGGESTED_QUESTIONS = [
  "Summarize all communication this week",
  "What are the open action items from our last call?",
  "How are our campaigns performing this week?",
  "Draft a weekly call agenda based on recent activity",
  "What was the Meta CPL trend over the last 4 weeks?",
  "Which verticals are performing best right now?",
];

export default function AIAssistantPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history for context
      const conversationHistory = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          client_id: activeClient.id,
          question: content.trim(),
          conversation_history: conversationHistory,
        },
      });

      if (error) throw error;

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
        sources: data.sources || [],
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('AI Assistant error:', err);
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error processing your question. Please try again.\n\n_Error: ${err.message || 'Unknown error'}_`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
      toast.error('Failed to get AI response');
    } finally {
      setIsLoading(false);
    }
  };

  const initials = teamMember?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

  return (
    <div className="flex h-full gap-4">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 pb-3 border-b mb-4">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">AI Assistant</h1>
          <span className="text-xs text-muted-foreground">— {activeClient.name}</span>
          <span className="ml-auto text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Live — Context Engine Connected</span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Sparkles className="h-10 w-10 text-primary/20 mb-3" />
              <h3 className="text-base font-medium mb-1">Ask me anything about {activeClient.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                I have access to your ad platform data, Fathom recordings, Slack communications, Ringba calls, tasks, and meeting agendas — all in real time.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    className="text-xs h-auto py-1.5 px-3"
                    onClick={() => sendMessage(q)}
                  >
                    <Lightbulb className="mr-1 h-3 w-3" />
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div className={`max-w-[70%] rounded-lg px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <p className="text-[10px] font-medium opacity-70 mb-1">Sources referenced:</p>
                    {msg.sources.map((s, i) => (
                      <p key={i} className="text-[10px] opacity-60">• {s.title} ({s.source})</p>
                    ))}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials}</AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-accent rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Analyzing context & dashboard data…</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t pt-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Ask about ${activeClient.name}...`}
              className="min-h-[44px] max-h-[120px] resize-none text-sm"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
            />
            <Button
              className="shrink-0 self-end"
              size="icon"
              disabled={!input.trim() || isLoading}
              onClick={() => sendMessage(input)}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Powered by Context Engine — querying Fathom, Slack, ad platforms, Ringba, and task data in real time.
          </p>
        </div>
      </div>
    </div>
  );
}
