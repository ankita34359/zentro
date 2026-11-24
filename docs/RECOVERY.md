# Recovery: putting a backup back

For the person who looks after Zentro. No programming needed, but you do need access to the app's page on **Embarko** (where the app runs). Read "What the backups are, and are not" first.

## What the backups are, and are not

- Zentro copies its whole database **once a day** (about 03:00 UTC, whenever the five-minute timer first runs after that) and keeps the **newest 14**. Before every update that changes the database it also makes a **pre-update copy** (the newest 3 are kept).
- The copies are made with SQLite's own safe backup method, checked by opening them and running SQLite's integrity check, and only then kept.
- They sit **on the server's own disk**, in the app's data folder, next to the database. They are **never** available to download from the website.
- **They do not protect you if the server or its disk is lost.** If that disk goes, the database and every copy go with it. An off-server copy (a copy kept somewhere else) is a later step and does not exist yet. Until then, do not treat Zentro as safe from losing the server.
- The copies protect against **a mistake or a bad update**: someone deleted the wrong thing, a bad change was saved, an update broke the data.

## Step 1: find out what you have

1. Sign in as an administrator (the Owner).
2. Go to **Settings → System**.
3. Under **Backups** you see the time of the last backup and whether it worked, how many copies exist, and the **newest copies by file name**, for example `daily-2026-11-24T03-00-12-345Z.db`. The date and time are in the name (UTC).
4. Write down the file name of the copy you want. Choose the **newest one from before the problem started**.

If you cannot sign in at all, open the app's **Logs** on Embarko and look for lines saying `daily backup written`: each carries the file name.

## Step 2: decide what to do

- **The app got worse after an update, but your data is fine:** roll the app back to the earlier version instead (Embarko → your app → Deployments → pick the earlier one → Roll back, or ask whoever deploys for `scripts/embarko-rollback.sh zentro`). A rollback changes the program only, **not the data**.
- **The data itself is wrong or lost:** restore a backup (Step 3). Everything entered **after** that backup was made is lost. Tell your people what time you are going back to.

## Step 3: restore a backup

1. Open the app on **Embarko → your app → Settings / Environment variables** (the same page where `SESSION_SECRET` lives).
2. Add one new setting: name `RESTORE_BACKUP`, value = the file name from Step 1, **typed exactly** (no folder, no spaces). Save it and let Embarko restart the app (it may be called **Apply** or **Restart**).
3. What happens on that start, before anyone can use the app:
   - Zentro checks that the file is a real, intact backup. If not, it **refuses and changes nothing**.
   - It makes a **fresh safety copy of the current data first**, named `pre-restore-…db`, so the restore itself can be undone.
   - It puts the backup in place and then starts normally. Any newer database updates are applied on top of the old data (with their own pre-update copy).
4. Open the app's `/healthz` page (for example `https://your-app.embarko.app/healthz`). You should see `"ok":true,"ready":true`. Sign in and look at **Settings → System** and your data.
5. **Remove the `RESTORE_BACKUP` setting** and restart again. It only restores once per exact value, so leaving it does no harm, but removing it keeps things clear. (To restore the same file a second time on purpose, add `@second-try` to the end of the value.)

## If something looks wrong afterwards

- **Wrong backup chosen:** repeat Step 3 with a different file name. The safety copy `pre-restore-…db` is also a valid name to restore, if you want to go back to what you had before the restore.
- **The app says the restore was refused:** read the Embarko log line that starts `restore refused`. It names the reason (file not found, not a Zentro database, failed integrity check). Nothing was changed; fix the name and try again.
- **Nothing helps:** do not delete anything. Keep the Embarko logs and ask someone technical, with the file names from the System page.

## Checking a backup file yourself (technical)

A backup is an ordinary SQLite file. With a copy on a computer that has SQLite: `sqlite3 backup.db "PRAGMA integrity_check;"` must print `ok`. The test suite does this for every backup it makes.
