# Sangriva

A personal, offline media catalog for your hard drives. It shows what you already own (movies, TV series, music, games) like a movie database, remembers it when a drive is unplugged, and never renames anything on your drives.

## How to run
1. Install Node.js (LTS) from https://nodejs.org if needed
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```
3. Click **Scan Folder / Drive** and pick a drive (or a folder on it).

## What's in it
- **Overview**: totals, recent additions, missing episodes and franchise movies, drive status
- **Library / Movies / TV Series / Music / Games**: poster grid or list, filters (Online now, Offline, Added this month), sorting, Ctrl+K quick search
- **Series page**: click a series to see its seasons and every episode as Available, Missing or Not aired yet
- **Movie and series pages**: description, rating, cast and crew. Click a person to see everything else they appear in, marked as in or not in your library
- **Missing Content**: missing TV episodes, and gaps in franchises (TMDB collections plus the universes listed in `franchises.json`, e.g. Marvel Cinematic Universe)
- **Drives**: name each drive and write its shelf location. Drives are recognised by their volume serial number, so a drive that comes back as another letter (E: becomes F:) is still the same drive and keeps its shelf label
- **Posters**: a poster already in the folder (poster, folder, cover, `<name>-poster`) is used first; otherwise it is fetched from TMDB. All posters, cast photos and info are saved on your computer, so the catalog works with the drives unplugged and no internet
- **Organize**: tick folders, see "from → to" for each, then confirm. Folders go into Movies / TV Shows / Music / Games at the drive root, on the same drive, and are only moved, never renamed

## New in 1.3
- **Play**: movies open the main video (samples skipped), series open the first episode you own (each owned episode has its own ▶), albums open as a playlist and each track plays on its own. Games only have Open folder.
- **Clean titles**: `The.Dark.Knight.2008.1080p` shows as "The Dark Knight (2008)". The folder on disk is never changed (shown as "Folder: ..." on the page).
- **Quality badges** (4K / 1080p / 720p / SD) on cards and lists.
- **Collections**: franchise tiles open every part in release order. Movie pages show an "In this series" row with "Next".
- **Duplicates**: identical copies (space you could free) and "Keep both" for different quality or a show split across drives. Nothing is deleted from this screen.
- **Compare Drives**: what drive A has that drive B lacks. **Copy** writes to a temporary folder, checks file count and sizes, then renames it. The original is untouched. Only afterwards are you asked "Delete original?" (goes to the Recycle Bin).
- **Storage** analytics and **Shelf List** (print or export CSV).
- **Games** get covers and descriptions from the Steam store (no key); music uses album art embedded in the files, with artist, album and track pages.
- **Clear Library** asks first, shows how many items it removes, keeps drive names and shelf labels, and can optionally delete saved posters.
- **Loose movie files** (one big folder of `Movie.2010.mkv` files with no subfolder per movie) are catalogued too: video files of 100 MB or more, skipping samples, trailers and episodes. Open folder becomes Show file; Copy and Delete original work on the single file.
- Re-scan each drive once after updating so sizes, quality and tracks are filled in.

## New in 2.9: Sangriva

The app is now called **Sangriva**. Your existing catalog is found automatically (the data folder from earlier versions is reused, so nothing is lost).

- **First-run setup:** language, optional TMDB key, and a choice to scan your first drive or try a small **demo catalog** (removable any time in Settings & About). Existing users do not see it.
- **Portable mode:** put an empty file named `portable.flag` next to the program and restart; the catalog is then kept in a `SangrivaData` folder beside it. The portable build made by the packaging step does this by itself.
- **Updates (opt-in):** when a GitHub repository is set in `brand.js` (`releaseRepo`), the app can tell you about a newer release and open its download page. It never downloads or installs anything by itself, and sends nothing about you.
- **Hindi (हिन्दी):** menus, page titles, filters and main buttons. Titles, file names and the phone/label pages stay as they are.
- **Settings & About:** language, updates, data folder, demo catalog and credits (TMDB, Steam, QR library, Electron).

### Making the installer (on Windows)
1. `npm install`
2. `npm run dist` builds an installer (`dist\Sangriva Setup x.y.z.exe`) and a portable program (`dist\Sangriva-Portable-x.y.z.exe`).
3. To publish: create a GitHub repository, set `releaseRepo` in `brand.js` to `owner/repo`, and upload the two files to a Release tagged like `v2.9.0`.
Unsigned programs make Windows SmartScreen show a warning the first time; a code-signing certificate removes it.

### Before you release
- Check the name Sangriva yourself: domain, and the India trademark register (Class 9 and 42) at ipindia.gov.in.
- Add the official TMDB logo next to the credits text if you publish (TMDB asks for it): themoviedb.org/about/logos-attribution.

## New in 2.8

**Organise without renaming**
- **Move Planner:** pick titles on one drive, choose another, and see a preview first (size, space left, what is left out and why). Each title is copied, checked against the original, and only then does the original go to the Recycle Bin. Names and folders never change. Marks, ratings and tags follow the title. **Recent moves** has an Undo for 30 days. If something now sits in an old spot, that item is left alone and you are told.
- **Keep franchises together:** the preview offers the other films of the same franchise that are on another drive, and a list shows collections split across drives with a "Gather" button.
- **Clean Up:** junk finder (sample clips, partial downloads, torrent and website leftovers, Thumbs.db, empty folders; game folders are never searched). You approve, then it goes to the Recycle Bin. Only files that are still junk at that moment are removed.
- **Inbox suggestions:** folders in an inbox-style place or loose on a drive are suggested for the folder where the rest of their kind lives. Nothing moves until you approve, and it can be undone in Move Planner.

**Share and look better**
- **Look & Share:** light, dark or automatic theme, compact spacing, and a poster-size slider.
- **Phone view** (off by default): a read-only page for your phone on the same Wi-Fi while the app is open. It needs a secret key in the link, serves only the list and posters, and "Make a new key" stops old links.
- **Drive labels:** printable labels with a QR code per drive (opens that drive in the phone view when it is on).
- **Catalog web page:** one searchable page for any browser.

QR codes use the MIT-licensed qrcode-generator library (qrlib.js).

## New in 2.7

**Protect your data**
- **Copy Safety** page: how many titles live on one drive only, what you would lose if each drive failed, and the biggest titles worth backing up first. Tick titles that have a copy in the cloud or on discs to mark them "backed up elsewhere".
- **Drives** now show when each was last scanned, warn when a drive has not been seen for 90+ days, and estimate when it will fill up (needs about two weeks of history) .
- **Check for broken files** (read-only): finds missing, empty, tiny or unreadable files and damaged headers. It is a quick check, not a full integrity test. Nothing is changed.

**Daily use**
- **To Watch** queue (＋ on any poster) and **Tonight's pick** with genre, length and "drives plugged in" filters.
- **My rating** (1 to 5 stars) and **tags** with filters in Movies and TV Series.
- **TV progress**: mark episodes watched, mark a season, see "N of M watched" and the next episode.
- **New on the shelf** on the Overview.

## New in 2.6
- **Drives and Storage are one page**: each drive card now shows its space breakdown (movies, series, music, games, other), with video quality and biggest items below. The Storage tab is gone.
- **Upgrades tab removed**: open a movie that is 720p or SD and press **⬆ Wish to Upgrade**. It appears in the Wishlist as "Better than 720p" and leaves by itself once you own it in 1080p or 4K.

## New in 2.5
- **Manage Franchises** (button on the Collections page): add, edit or remove the universes (name + TMDB keyword) in a dialog instead of editing `franchises.json`. Duplicate names or keywords are refused. Removing one only removes the grouping, never your media. New ones are fetched from TMDB straight away if your key is set. The list is saved in your user data folder and is included in backups.
- **Universe pages are split into sub-series**: a universe such as the Marvel Cinematic Universe shows one section per collection (Iron Man, Thor, Avengers…), then TV series, then standalone films, each with its own "owned of total" count. Sub-series are named from the TMDB collections of titles you own, so sync info after adding movies.

## New in 2.4
- **Backup & History** tab: save your whole catalog and every choice (matches, wishlist, watched marks, languages, collections order) to one file, or restore from one (the app restarts). A daily automatic copy (last 7) and a safety copy before Clear Library or a restore (last 5) are kept. Posters, cast info and your TMDB key are not in a backup.
- **Scan history**: after each scan, how many items are new, no longer there, or changed, shown in the status bar and listed in Backup & History.
- **Movie versions**: the same movie in 720p and 1080p (or on two drives) shows as one card with an "N versions" chip; the movie page has a versions table (quality, size, drive, online). Untick "Group versions" in the filter bar to see every copy.
- **Watched ✓ and Favourite ★** marks on movie and TV cards and pages, with a Status filter.
- **Search operators** (type in the top search): `>10GB`, `<2GB`, `2160p`, `1080p`, `offline`, `online`, `watched`, `unwatched`, `fav`, `type:movie`, `year:2010`, `drive:HDD 03`. Mix them with words.
- **Compare Drives** is back: pick two drives and see what is only on one, on both, or in different quality.
- **Videos**: length filter (min and max minutes).

## New in 2.3
- **Upgrades** tab: every 720p / SD movie, with ♡ Add to wishlist (a “better version” entry that leaves the Wishlist once you own it in 1080p / 4K).
- **Find on Drive** tab: type a title, artist, actor or genre; shows the drive, shelf and whether it is plugged in (works with drives unplugged).
- Movies ↔ TV: TV cards / pages have “Not a TV Show → Movies” and “Remove from TV Series” (sends it to Videos); movie cards / pages have “Not a Movie → TV Show” (asks for the show name); “Back to TV Series” / “Back to Movies” undo.
- Videos: sort by Length, Name or Size, click again to reverse (unknown lengths stay last).
- Missing: a franchise name (or “Open collection ›”) opens the whole collection, owned and missing.
- Movies: **3D** in the Quality filter (3D, HSBS, H-OU names).
- Status messages fade back to “Ready”.

## New in 2.2
- Collections: the Movies / TV Series buttons are gone; every franchise shows its movies and series together.
- Missing: every show and franchise is collapsible (Expand all / Collapse all; they start collapsed).
- “Not a show → Movies” is now on every TV Series card and list row (hover the poster), as well as on the show page.

## New in 2.1
- Collections keep Movies and TV Series apart (each tab lists only its own kind).
- TV Series: Complete / Incomplete buttons (green / orange dot).
- Search finds titles by cast, characters, director / creator, genre, language and year; every word typed must match. Ctrl+K lists those under the person results.
- Missing Content renamed Missing, and lists only what is missing.
- A series that is really a movie: “Not a TV show → Movies” on its page (and “Back to TV Series”).
- Smoother: the screen no longer redraws by itself every minute or when disk space changes; background refreshes keep your scroll position and only redraw when something really changed.
- Extras / featurettes / behind-the-scenes folders are no longer shown as a TV show.

## New in 2.0
- Movies/TV: change a title’s language on its page (set by you; “Automatic” resets it).
- Videos: length shown in front of every video.
- Collections: Movies / TV Series buttons, All / Incomplete / Complete buttons, Arrange menu; inside a collection: All / Owned / Missing and Arrange (release order, A–Z, missing first, owned first).
- Posters now show for missing titles in Collections, Missing Content and “In this series”.
- Games: ✕ Remove on every game card (kept under “Removed”, can be put back).
- TV Series: green dot = complete, orange dot = missing episodes.
- Organize tab removed.

## New in 1.9
- **Filter bar** on Library / Movies / TV: labeled dropdowns — Quality, Genre, Language, Rating, Year, Availability, Order by.
- **Music** redesigned: Artists / Albums / Singles tabs, artist cards, album page with track table, artist page.

## New in 1.8

- **Wishlist tab:** a ♡ appears on missing items only (franchise gaps in Collections / Missing Content, and missing episodes on a show's page). Wishlist entries leave by themselves once the movie, show or episode shows up in your library.
- **Games:** "Not a game" is now **Remove** and removed games sit in a "Removed" list with **Put back**. A name that exists on Steam is no longer enough: the folder must also look like an install (Steam/Unity files) or be large. Folders under 50 MB are ignored.
- **Videos:** shows each video's **length** (read from the file header). The Assign search box starts empty and keeps what you type and its results.
- **TV:** a show page has **All / Missing / Available** filters. Files the app could not number are listed last in their season with **Assign episode number**.
- **Cast:** "Also appears in" now shows posters.
- **Music:** each song has a **Remove** button (Recycle Bin only; a drive with no Recycle Bin is left untouched).
- **Movies / TV / Library:** **Group by Quality, Language or Genre**. Language comes from a word in the file name (Hindi, Tamil…) or TMDB's original language.

## New in 1.7

- **Videos tab:** every loose or unconfirmed video lands here instead of cluttering Movies / TV Series: YouTube clips, intros, files under 100 MB, names TMDB can't match, and shows it can't confirm. Each row has **Assign…** (search the real movie or show; a loose file can become a movie or an episode of a show, and then appears under Movies / TV Series), **Open folder**, **▶** and a checkbox for deleting.
- **Delete is Recycle Bin only.** "Move to Recycle Bin" asks first, lists what it will move, and never erases permanently. If a drive has no Recycle Bin the file is left alone and you are told which ones were not deleted.
- **Review Matches tab removed**; the Videos tab does that job. Matched titles stay in Movies / TV Series; the catalog never renames your files.
- Loose videos of 20 MB and up are now catalogued (before, anything under 100 MB was skipped) so they can be reviewed or deleted. Re-scan to pick up the small ones.

## New in 1.6

- **Music:** Music opens on **Artists**. Pick an artist to see their **Albums** and **Singles**; pick an album to see its songs. Loose songs (a folder with one or two tracks, or a folder called "Singles") are kept as singles under their artist. A "All albums" tab keeps the flat list. Singles appear after the next scan.
- **Games:** only confirmed games are shown and counted. A game is confirmed when it is found on Steam, looks like a real install (Steam/Unity files, .pak data, a few hundred MB), or you click **Yes, a game**. Everything else with an .exe waits in **Possible games to confirm** on the Games tab (Open folder / Yes / Not a game / Confirm all). Tiny tools are ignored. Your answers are remembered.
- **TV:** when an episode exists in more than one folder (or drive) every location is shown in front of the episode name, each with its own **Open folder** button.
- **Movies:** loose files are filtered again, same rule as before except clips and non-films are skipped ("01.mp4", "0 Intro Demos", "... - YouTube", music videos, trailers). Old scan data is cleaned at display time, no rescan needed.
- **Tidy Episodes** tab removed.
- **Faster scans:** folders are listed and measured once per scan instead of several times (about 30% fewer disk reads on large libraries).

## New in 1.5

- **One entry per show**: old per-folder TV entries (Vikings ×6, The Walking Dead season folders…) are grouped by show name, even while the drives are offline. Play and Tidy still need a rescan for those. Duplicates now compares shows by the episodes they share, so seasons of one show are no longer "duplicates".
- **Missing Content**: shows whose files carry no episode numbers are listed as "Can't check" and kept out of the totals. The list is sorted by closest to complete (switch to Most missing or A–Z).
- **Review Matches**: a clearly famous title is accepted without asking (popularity), as are near-identical names with no close rival; extra words at the end of a name are dropped ("… Raw and Undekha"); a bare "Episode" in a title no longer cuts it. The page has "Confirm all best guesses" and a collapsed "No match" section with "Hide all".
- **Games**: crack and installer folders (SKIDROW, Razor1911, CD Drive, Setup…) are part of their game; TV episode folders are never games. Hidden from old scan data too.
- **Music**: Disc 1 / CD 2 / Vol 1 folders are merged into their album, also for old scans.
- **Movies**: extras, featurettes and samples folders are hidden, also for old scans.

## New in 1.4.1

- **Episodes**: click an episode's name to play it. Hover a row to see which drive and file it is in, and use **Open folder** to jump to it.
- **Compare Drives** and **Shelf List** tabs removed (shelf labels still show on the Drives page).
- **Collections**: a franchise needs two or more titles (movies and/or series) to count. Single titles are no longer listed. Series that share a franchise keyword with movies (for example the MCU) are included.
- **Numbered files** such as `095 - Goku vs Krillin.avi` (three or more in a folder) are read as episodes of the show named by the folder, also for libraries scanned before, without a rescan.
- **Adult results** from TMDB are never matched or offered as candidates. Old candidate lists are cleared; "no match" items are searched again on the next Fetch Posters.

## New in 1.4
- **Smart names**: `Scarface.198h3.720p...` (unreadable year) and `The.A.Team.EXTENDED.2010.720p...` (edition word before the year) are read correctly. Release tags, editions, languages and site prefixes are ignored.
- **Review Matches**: when a name is uncertain (unreadable year, several titles with the same name, only a similar title found, or nothing found) the app shows its best guess and the closest alternatives. **Yes** saves it for good (TMDB title, year and poster); you can also pick another, search by hand, or skip. A badge in the menu shows how many are waiting.
- **Series -> Season -> Episodes**: every episode file is read, wherever it is (a show folder, a season folder, loose in a folder, on another drive) and filed under one Series card. `Squid.Game.S02E01.DUAL-AUDIO.KOR-ENG.1080p...` becomes Squid Game, Season 2, Episode 1. The show page lists where its episodes are.
- **Loose files everywhere**: movies and episodes are found whether they sit in their own folder or loose in a big folder.
- **Tidy Episodes**: each season's main folder is the one holding most of its episodes. Episodes found elsewhere get a Move. Same drive = moved. Another drive = copied and checked, then you decide about deleting the original.
- **Live drive detection**: every drive (the system drive and external ones) is listed on its own and checked every few seconds; unplugging, plugging in or a drive coming back under another letter is picked up without a refresh.
- **Collections** only list titles that are already released (or that you own).
- Compare Drives can copy a show's missing episodes to the other drive, into the same folders.
- Scanning a folder again removes entries for files that have since been moved or deleted (only when the scan had no unreadable folders).

## TMDB key and Sync
1. Click **TMDB Key** and paste your v3 API key or v4 Read Access Token (it is verified, then saved in the app data folder). The `TMDB_API_KEY` environment variable also works.
2. Click **Fetch Posters** for posters, and **Sync Info** for episode lists, cast and franchise info. Both are one-time downloads, refreshed occasionally.

## Rules the app follows
- The folder name is the identity of a title. File names are only *read* to work out episode numbers (`S01E02`, `1x02`, `Episode 2`, `02 - Title`); nothing is ever renamed.
- A season whose files carry no episode numbers is reported as "can't check" instead of "all missing". Specials (season 0) are never counted as missing. Episodes that have not aired yet are never counted as missing.
- Franchise gaps only list movies that are already released.
- Add your own franchises by editing `franchises.json` (`name` plus a TMDB `keyword`), or copy it into the app data folder to keep your changes across updates.

## Notes
- Your catalog is stored in the app data folder (`library.json`, `drives.json`, `posters/`, `meta/`).
- Re-scan a drive after updating so older items are linked to it and season folders are grouped under their show.


## 2.9.1
- "Wrong movie? Correct it" button on every movie and show: search TMDB, pick the right one, remembered. "Go back to automatic" undoes it.
- "Piranha 3D (2010)" no longer loses its "3D".
- Phone view: best Wi-Fi address first, QR for each address, "Test it" button, help for Windows firewall.
- Faster start-up and browsing on big libraries; Sync Info shows time left.
- Comfortable spacing is now explicit; the poster-size slider really resizes posters.
- TMDB/Steam credit in the sidebar (drop the official logo into assets/tmdb.svg). Demo catalog shows a banner with a Remove button.
- Tags and My rating removed.

## 2.9.2
- Right-side scrollbar hidden. Sidebar menu scrolls on its own; TMDB/Steam credit stays pinned at the bottom of the sidebar.
- When TMDB cannot be reached, Fetch Posters and Sync Info stop early with a clear message instead of waiting on every title.

## 2.9.3
- Dark theme: every light panel, row, chip and badge now has a dark version, so text is readable everywhere (checked automatically on all screens).

## 2.9.4
- Your Sangriva logo: sidebar, window and taskbar icon, installer icon (build/icon.ico), welcome screen and Settings & About.
