"use client";

import { AccountPanel } from "./AccountPanel";
import { Logo } from "./Logo";

export type AppView = "overview" | "policies" | "create" | "how" | "activity";

const navigation: { id: AppView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "policies", label: "Policies" },
  { id: "create", label: "Create policy" },
  { id: "how", label: "How it works" },
  { id: "activity", label: "Activity" },
];

interface NavbarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

export function Navbar({ activeView, onNavigate }: NavbarProps) {
  return (
    <header className="site-header">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-5 py-4 lg:px-8">
        <button
          className="shrink-0 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lichen)]"
          onClick={() => onNavigate("overview")}
          type="button"
        >
          <Logo size="sm" theme="light" />
          <p className="mt-0.5 pl-9 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mist)]">
            Parametric settlement layer
          </p>
        </button>

        <nav className="hidden items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5 lg:flex" aria-label="Primary navigation">
          {navigation.map((item) => (
            <button
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeView === item.id
                  ? "bg-[var(--lichen)] text-[var(--ink-950)]"
                  : "text-[var(--mist)] hover:bg-white/[0.06] hover:text-[var(--paper)]"
              }`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-xs font-medium text-[var(--mist)] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lichen)] shadow-[0_0_12px_var(--lichen)]" />
            GenLayer network
          </span>
          <AccountPanel />
        </div>
      </div>
      <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-5 pb-3 lg:hidden">
        {navigation.map((item) => (
          <button
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium ${
              activeView === item.id
                ? "bg-[var(--lichen)] text-[var(--ink-950)]"
                : "text-[var(--mist)]"
            }`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}
