import { useCallback, useEffect, useState } from "react";

export interface ReaderBookmark {
    id: number;
    page: number;
    label: string | null;
}

interface GuestBookStorage {
    lastPage?: number;
    bookmarks?: ReaderBookmark[];
}

function storageKey(bookId: number): string {
    return `koakademy:library:guest:book:${bookId}`;
}

function readGuestBookStorage(bookId: number): GuestBookStorage {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(storageKey(bookId));
        if (!raw) return {};
        const parsed = JSON.parse(raw) as GuestBookStorage;

        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

function writeGuestBookStorage(bookId: number, payload: GuestBookStorage): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(storageKey(bookId), JSON.stringify(payload));
    } catch {
        // Ignore storage quota or private-mode failures.
    }
}

export function useGuestReadingState(bookId: number, enabled: boolean) {
    const [initialLastPage] = useState<number | null>(() => {
        if (!enabled) return null;
        const stored = readGuestBookStorage(bookId);
        return typeof stored.lastPage === "number" && stored.lastPage >= 1 ? stored.lastPage : null;
    });

    const [guestBookmarks, setGuestBookmarks] = useState<ReaderBookmark[]>(() => {
        if (!enabled) return [];
        const stored = readGuestBookStorage(bookId);
        return Array.isArray(stored.bookmarks) ? stored.bookmarks : [];
    });

    useEffect(() => {
        if (!enabled) return;
        const stored = readGuestBookStorage(bookId);
        setGuestBookmarks(Array.isArray(stored.bookmarks) ? stored.bookmarks : []);
    }, [bookId, enabled]);

    const saveGuestLastPage = useCallback(
        (page: number) => {
            if (!enabled) return;
            const current = readGuestBookStorage(bookId);
            writeGuestBookStorage(bookId, { ...current, lastPage: page });
        },
        [bookId, enabled],
    );

    const toggleGuestBookmark = useCallback(
        (page: number): ReaderBookmark[] => {
            const current = readGuestBookStorage(bookId);
            const existingList = Array.isArray(current.bookmarks) ? current.bookmarks : [];
            const exists = existingList.some((item) => item.page === page);
            const nextList = exists
                ? existingList.filter((item) => item.page !== page)
                : [...existingList, { id: Date.now(), page, label: `Page ${page}` }].sort((a, b) => a.page - b.page);

            writeGuestBookStorage(bookId, { ...current, bookmarks: nextList });
            setGuestBookmarks(nextList);

            return nextList;
        },
        [bookId],
    );

    const removeGuestBookmark = useCallback(
        (bookmarkId: number) => {
            const current = readGuestBookStorage(bookId);
            const existingList = Array.isArray(current.bookmarks) ? current.bookmarks : [];
            const nextList = existingList.filter((item) => item.id !== bookmarkId);
            writeGuestBookStorage(bookId, { ...current, bookmarks: nextList });
            setGuestBookmarks(nextList);
        },
        [bookId],
    );

    return {
        initialLastPage,
        guestBookmarks,
        saveGuestLastPage,
        toggleGuestBookmark,
        removeGuestBookmark,
    };
}
