"use client";

const KEY = "v2:announcement-draft";

export type AnnouncementDraft = { title: string; description: string };

/** Actions that should end in an announcement (e.g. rain → Zoom) leave a prefilled draft for the composer. */
export function saveAnnouncementDraft(draft: AnnouncementDraft) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // The composer simply opens empty if storage is blocked.
  }
}

/** Reads the draft without consuming it (safe under React StrictMode's double initializers). */
export function peekAnnouncementDraft(): AnnouncementDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnnouncementDraft>;
    return typeof parsed.title === "string" && typeof parsed.description === "string" ? { title: parsed.title, description: parsed.description } : null;
  } catch {
    return null;
  }
}

export function clearAnnouncementDraft() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function takeAnnouncementDraft(): AnnouncementDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<AnnouncementDraft>;
    return typeof parsed.title === "string" && typeof parsed.description === "string" ? { title: parsed.title, description: parsed.description } : null;
  } catch {
    return null;
  }
}

export function hasAnnouncementDraft() {
  try {
    return Boolean(window.sessionStorage.getItem(KEY));
  } catch {
    return false;
  }
}

/** Lets deep inside a panel ask the page to switch the active view (e.g. rain → Zoom → announcement). */
export function requestNavigation(view: string) {
  window.dispatchEvent(new CustomEvent("v2:navigate", { detail: view }));
}
