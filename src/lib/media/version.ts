/** Bump when the narration changes, so books released before it are narrated again once. */
export const MEDIA_VERSION = 2;
export const mediaVersionKey = (bookId: string) => `${bookId}:media:v${MEDIA_VERSION}`;
