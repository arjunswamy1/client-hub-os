import { useState, useRef, useEffect } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Send, User, Sparkles, Lightbulb } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: { title: string; source: string }[];
}

const SUGGESTED_QUESTIONS = [
  "Summarize all communication this week",
  "What are the open action items from our last call?",
  "What creative concepts have we tested?",
  "Draft a weekly call agenda based on recent activity",
  "What was the Meta CPL trend over the last 4 weeks?",
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
    if (!content.trim()) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response (will be replaced with real API in Phase 5)
    setTimeout(() => {
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `I'm the AI Assistant for **${activeClient.name}**. Once the Context Engine is connected (Phase 2), I'll be able to answer questions using data from your Slack, Teams, Gmail, Fathom recordings, and ad platform metrics.\n\nFor now, this is a preview of the chat interface. Your question was: "${content.trim()}"`,
        timestamp: new Date(),
        sources: [
          { title: 'Context Engine integration pending', source: 'System' },
        ],
      };
      setMessages(prev => [...prev, assistantMsg]);
      setIsLoading(false);
    }, 1500);
  };

  const initials = teamMember?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

  return (
    <div className="flex h-full gap-4">
      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 pb-3 border-b mb-4">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">AI Assistant</h1>
          <span className="text-xs text-muted-foreground">— {activeClient.name}</span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Sparkles className="h-10 w-10 text-primary/20 mb-3" />
              <h3 className="text-base font-medium mb-1">Ask me anything about {activeClient.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                I can summarize communications, review metrics, draft agendas, and find information across all your client data.
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
                    <p className="text-[10px] font-medium opacity-70 mb-1">Sources:</p>
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
                <div className="flex gap-1">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
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
            AI responses are generated previews. Full RAG integration coming in Phase 5.
          </p>
        </div>
      </div>
    </div>
  );
}
