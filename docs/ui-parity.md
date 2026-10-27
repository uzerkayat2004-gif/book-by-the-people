# Live screen parity

Source of truth: the Oct 27 2026 capture of https://bookbythepeople.base44.app (`live/INVENTORY.md` and the screenshots beside it). Side-by-side images (live on the left, this app on the right, 1280×800) are in the agent parity store, named after each live file.

Pages are rendered at the live page viewport, 1280×742 (a 1280-wide Chrome window with the 58px browser bar cropped off). The header pill measures 788×36px on the live PNGs and is matched at that width. The home headline cap is 48px against the live 50px. Studio settings cards are 440px wide. The /me column is 419px against the live 413px.

The featured home shows two voices from India, Usman and Uzer Kayat, with the ticker “Uzer Kayat from India just spoke.” The other sample voices stay in the database, hidden, so the published reader can still play them.

Studio screens were compared on an empty owner book (`book-by-the-people`) so the zero-voice layout can sit next to the live empty studio. The sample book keeps its five playable voices for the reader.

## Screens

| Live file | Status |
| --- | --- |
| 01-home-1 … 01-home-6 | Layout, copy, globe, countdown, poll, and footer match. Remaining: 5 voices / 4 countries / Chloe Martin, not 2 voices / India / Uzer Kayat. |
| 02-speak-signin-gate | Match, plus the email magic-link form under Continue with Google so sign-in works without Google OAuth. |
| 03-about-dialog, 04-privacy-dialog, 05-how-ai-checks-dialog | Match. |
| 06-404 | Match. No header. |
| 08-book-countdown, 34-book-signedin | Match. |
| 09-studio-signin-gate | Match, plus the email form. |
| 10-about-page, 11-privacy-page | Match. |
| 20-studio-settings-1 … 4 | Match on the empty book: question, release time (Oct 26 · 12:00 AM IST), voices toggle, AI paused, poll, sample data, reset, debug. |
| 21-studio-ai-at-work-1 … 2 | Match, including the spend card. The model chip copies the live label. Calls still go through muse-voice-transcribe / muse-spark when `AI_MODE=live`, and the mock provider otherwise. There is no 60-second background job; Run AI now refreshes the desk. |
| 22-studio-make-1 … 2 | Match. Backup history is empty (`none yet`) rather than the live site's six old rows. Test run and Download backup are present. |
| 23-studio-release-1 … 2 | Match, except audio/video rows have no `t-rex-roar.mp3` or `flower.mp4` until a file is replaced in. The cover byline follows this book's voice count (0 on the empty book). |
| 30-me-page, 31-me-edit-profile-modal | Match for the demo profile (Uzer Kayat, Gujarat, India, 18–24, @uzerkayat). |
| 32-speak-1 | Match, including the start-word card. The word is random; `?word=flower` pins it in mock mode for comparison. |
| 32-speak-language-dropdown | The 30 languages and the Hindi separator are in the control. The open list is the page's select, not the operating-system menu. |
| 33-home-signedin-1 … 2 | Same as the public home, with STUDIO and the avatar menu. Same voice-count difference. |

Hackathon pieces that are not on the live site: email magic link, New book (solo, invited, open, famous quotes), the same four-tab studio for each creator, and the reader at `/b/[slug]/read`.
