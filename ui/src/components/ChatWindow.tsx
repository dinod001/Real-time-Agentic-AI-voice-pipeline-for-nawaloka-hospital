import { useEffect, useRef } from "react";
import { Sparkles, Clock, CalendarDays, FileText, User, ChevronRight } from "lucide-react";
import type { UIMessage } from "@/types";
import type { ThoughtItem } from "@/hooks/useChatStream";
import { ChainOfThought } from "./ChainOfThought";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: UIMessage[];
  loading: boolean;
  thoughts: ThoughtItem[];
  error: string | null;
}

export function ChatWindow({ messages, loading, thoughts, error }: Props) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thoughts.length]);

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      {messages.length === 0 && !loading && (
        <EmptyState />
      )}

      <div className="space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {loading && <ChainOfThought items={thoughts} />}

        {error && (
          <div className="text-xs text-danger px-2">
            Connection error: {error}
          </div>
        )}

        <div ref={end} />
      </div>
    </div>
  );
}

function EmptyState() {
  const samples = [
    { text: "What are the opening hours of the hospital?", icon: Clock, color: "text-indigo-400", bg: "bg-indigo-500/15" },
    { text: "Do I have any appointments this week?", icon: CalendarDays, color: "text-teal-400", bg: "bg-teal-500/15" },
    { text: "What should I bring for my first appointment?", icon: FileText, color: "text-amber-400", bg: "bg-amber-500/15" },
    { text: "Show me all the dermatology consultants.", icon: User, color: "text-blue-400", bg: "bg-blue-500/15" },
  ];

  return (
    <div className="max-w-3xl mx-auto text-center py-12 space-y-6 animate-fade-in flex flex-col items-center">
      <div className="inline-flex items-center justify-center size-14 rounded-full bg-indigo-500/15 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.2)] overflow-hidden">
        <img src="/image.png" alt="Nawaloka Logo" className="size-8 object-contain" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-slate-100">
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 text-transparent bg-clip-text">Nawaloka</span> Health Assistant
        </h2>
        <p className="text-sm text-slate-400 mt-2 max-w-lg mx-auto leading-relaxed">
          Ask about appointments, doctors, policies, or procedures.<br />
          The agent routes your query across a CRM, internal KB (RAG),<br />
          semantic cache (CAG), and live web search.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-left mt-8 w-full">
        {samples.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.text} className="card flex items-center gap-4 p-4 cursor-pointer hover:bg-bg-card transition-colors group border-white/5">
              <div className={`shrink-0 flex items-center justify-center size-10 rounded-full ${s.bg}`}>
                <Icon className={s.color} size={18} />
              </div>
              <div className="flex-1 text-sm font-medium text-slate-300">
                {s.text}
              </div>
              <ChevronRight className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" size={18} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
