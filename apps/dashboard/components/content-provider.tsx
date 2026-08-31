"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ContentMap } from "@/lib/content";

const ContentContext = createContext<ContentMap>({});

/**
 * Layout'ta server'da okunan override haritasını client component'lere taşır.
 * Client tarafı `useContent().t(key, fallback)` ile metinleri çözer.
 */
export function ContentProvider({
  map,
  children,
}: {
  map: ContentMap;
  children: ReactNode;
}) {
  return <ContentContext.Provider value={map}>{children}</ContentContext.Provider>;
}

export function useContent(): {
  t: (key: string, fallback: string) => string;
  isHidden: (key: string) => boolean;
  map: ContentMap;
} {
  const map = useContext(ContentContext);
  return {
    map,
    t: (key: string, fallback: string) => {
      const v = map[key];
      return v != null && v !== "" ? v : fallback;
    },
    isHidden: (key: string) => map[`${key}.hidden`] === "1",
  };
}
