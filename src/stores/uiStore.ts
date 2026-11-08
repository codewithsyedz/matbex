import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";

/**
 * UI Store - Manages ephemeral UI state to prevent re-renders.
 * 
 * Using Zustand slices pattern for atomic updates:
 * - Sidebar state changes don't re-render dashboard cards
 * - Modal state changes don't re-render navigation
 * - Filter changes are isolated to their respective components
 */

interface SidebarState {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  toggleCollapsed: () => void;
  setMobileOpen: (open: boolean) => void;
}

interface ModalState {
  activeModal: string | null;
  modalData: Record<string, unknown>;
  openModal: (id: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

interface FilterState {
  searchQuery: string;
  activeFilters: Record<string, string | string[]>;
  setSearchQuery: (query: string) => void;
  setFilter: (key: string, value: string | string[]) => void;
  clearFilters: () => void;
}

interface CommandPaletteState {
  isOpen: boolean;
  recentCommands: string[];
  setOpen: (open: boolean) => void;
  addRecentCommand: (command: string) => void;
}

interface ToastState {
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center";
  setPosition: (position: ToastState["position"]) => void;
}

interface UIState extends SidebarState, ModalState, FilterState, CommandPaletteState, ToastState {}

export const useUIStore = create<UIState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Sidebar slice
      isCollapsed: false,
      isMobileOpen: false,
      toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      setMobileOpen: (open) => set({ isMobileOpen: open }),

      // Modal slice
      activeModal: null,
      modalData: {},
      openModal: (id, data = {}) => set({ activeModal: id, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: {} }),

      // Filter slice
      searchQuery: "",
      activeFilters: {},
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilter: (key, value) => 
        set((state) => ({ 
          activeFilters: { ...state.activeFilters, [key]: value } 
        })),
      clearFilters: () => set({ searchQuery: "", activeFilters: {} }),

      // Command palette slice
      isOpen: false,
      recentCommands: [],
      setOpen: (open) => set({ isOpen: open }),
      addRecentCommand: (command) => 
        set((state) => ({
          recentCommands: [command, ...state.recentCommands.filter(c => c !== command)].slice(0, 10)
        })),

      // Toast slice
      position: "bottom-right",
      setPosition: (position) => set({ position }),
    })),
    { name: "ui-store" }
  )
);

// Selector hooks for atomic subscriptions (prevents unnecessary re-renders)
export const useSidebarCollapsed = () => useUIStore((state) => state.isCollapsed);
export const useSidebarMobileOpen = () => useUIStore((state) => state.isMobileOpen);
export const useActiveModal = () => useUIStore((state) => state.activeModal);
export const useSearchQuery = () => useUIStore((state) => state.searchQuery);
export const useCommandPaletteOpen = () => useUIStore((state) => state.isOpen);
export const useToastPosition = () => useUIStore((state) => state.position);
