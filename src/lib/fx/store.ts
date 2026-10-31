import { create } from "zustand";
import { persist } from "zustand/middleware";
import { advanceBar, beginDay, createOpeningBook, flattenAll, type Book } from "./model";
import type { JournalEntry } from "./analysis";
import { mapPairs, type PairId, type RiskSleeve } from "./research";

export type Phase = "ready" | "running" | "paused" | "brief";

interface DeskState {
  book: Book;
  phase: Phase;
  risk: RiskSleeve;
  enabled: Record<PairId, boolean>;
  selected: PairId;
  run: () => void;
  step: () => void;
  flatten: () => void;
  reset: () => void;
  setRisk: (risk: RiskSleeve) => void;
  setBook: (cash: number, cent: boolean) => void;
  togglePair: (id: PairId) => void;
  select: (id: PairId) => void;
  journal: JournalEntry[];
  zone: string;
  venue: "paper" | "binance" | "metatrader" | "exness";
  record: (entry: Omit<JournalEntry, "id" | "at">) => void;
  clearJournal: () => void;
  setZone: (zone: string) => void;
  setVenue: (venue: "paper" | "binance" | "metatrader" | "exness") => void;
}

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      book: createOpeningBook(),
      phase: "ready",
      risk: "careful",
      enabled: mapPairs(true),
      selected: "EURUSD",
      run: () => {
        const { phase, book, risk } = get();
        if (phase === "running") {
          set({ phase: "paused" });
          return;
        }
        if (phase === "paused") {
          set({ phase: "running" });
          return;
        }
        set({ book: beginDay(book, risk), phase: "running" });
      },
      step: () => {
        const { phase, book, enabled, risk } = get();
        if (phase !== "running") return;
        const stepped = advanceBar(book, { trade: true, enabled, risk });
        set({ book: stepped.book, phase: stepped.done ? "brief" : "running" });
      },
      flatten: () =>
        set((s) => ({
          book: s.book.positions.length ? flattenAll(s.book, "Flattened by hand") : s.book,
        })),
      reset: () =>
        set((s) => ({
          book: createOpeningBook(s.book.cash, s.book.cent),
          phase: "ready",
          selected: s.selected,
        })),
      setRisk: (risk) => {
        if (get().phase === "running") return;
        set({ risk });
      },
      setBook: (cash, cent) => {
        if (get().phase === "running") return;
        set({ book: createOpeningBook(cash, cent), phase: "ready" });
      },
      togglePair: (id) => set((s) => ({ enabled: { ...s.enabled, [id]: !s.enabled[id] } })),
      select: (id) => set({ selected: id }),
      journal: [],
      zone: "Africa/Kampala",
      venue: "paper",
      record: (entry) =>
        set((s) => ({
          journal: [{ ...entry, id: `j${s.journal.length + 1}-${entry.pair}`, at: new Date().toISOString() }, ...s.journal].slice(0, 40),
        })),
      clearJournal: () => set({ journal: [] }),
      setZone: (zone) => set({ zone }),
      setVenue: (venue) => set({ venue }),
    }),
    {
      name: "nightbook-kampala-v1",
      skipHydration: true,
      partialize: (s) => ({
        book: s.book,
        phase: s.phase === "running" ? "paused" : s.phase,
        risk: s.risk,
        enabled: s.enabled,
        selected: s.selected,
        journal: s.journal,
        zone: s.zone,
        venue: s.venue,
      }),
    },
  ),
);
