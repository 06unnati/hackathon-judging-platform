# Hackathon Judging

A static judging site for GitHub Pages, with Firebase storing the schedule and rankings.

- **`index.html`**: the judge page. Judges enter their personal 8-character code, see the teams they're judging this round, and tap them from best to worst.
- **`admin.html`**: the admin page. Sign in with email and password to build the judge rotation, open each round, hand out judge codes, and watch the scoreboard.

## How judging works

- Set **n** teams, **j** judges, **x** rounds and **y** teams per judge per round.
- Each round the judging slots are spread evenly, so every team gets the same number of judges (or within one). Judges are rotated so nobody sees the same team twice when that's possible.
- The setup page warns you if a team would get 0 or more than 2 judges in a round, and tells you which value of y keeps every team at 1–2.
- Rank 1 = 1 point, rank 2 = 2 points, and so on. The lowest total wins.
- The top 3 uses competition ranking: tied teams share a place, and every tied team is shown.
- If the numbers don't divide evenly and some teams get judged more often, the scoreboard ranks by average rank instead of total, so extra judgings don't penalize anyone.

## Files

```
index.html            judge page
admin.html            admin page
style.css
js/firebase-config.js your Firebase keys (edit this)
js/firebase.js        Firebase setup
js/common.js          scheduling + scoring logic
js/judge.js
js/admin.js
firestore.rules       database security rules (paste into Firebase)
```

## Use it for your own hackathon

Anyone can run their own copy for free. Your copy has its own database and admins, and nobody else, including the person you got it from, can see or change your events.

1. Click **Fork** (or **Use this template**) at the top of the GitHub repo to get your own copy.
2. Follow the setup below with **your own** Google account: create your Firebase project, add yourself as admin, and paste **your** keys into `js/firebase-config.js`, replacing the ones already there.
3. Turn on GitHub Pages for your repo (step 5).

Don't reuse someone else's Firebase keys. If you do, you'd be writing into their database, and their rules would lock you out anyway.

## Setup (about 15 minutes)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com and click **Add project**. Google Analytics isn't needed.
2. **Build → Firestore Database → Create database**. Pick a location and start in **production mode**.
3. **Build → Authentication → Get started → Sign-in method**, then enable **Email/Password**.

### 2. Add the security rules
Open **Firestore Database → Rules**, replace everything with the contents of `firestore.rules`, and click **Publish**.

These rules make sure:
- Only admins can change the schedule, codes or round, and only admins can see all rankings.
- A judge can only submit a ranking for their own teams, for the current round or an earlier one, with each team ranked exactly once.

### 3. Create your admin account
1. **Authentication → Users → Add user**. Enter your email and a password.
2. Copy the new user's **User UID**.
3. **Firestore Database → Data → Start collection**. Set the collection ID to `admins` and the document ID to the UID you copied. Add any field, for example `email` = your email, then save.

Repeat for anyone else who should have admin access.

### 4. Connect the site to Firebase
1. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app; you don't need Firebase Hosting.
2. Copy the `firebaseConfig` values into `js/firebase-config.js`.

It's fine to commit these keys to a public repo. Firebase web keys only identify the project; the rules are what protect the data.

### 5. Publish on GitHub Pages
1. Push this folder to a GitHub repo.
2. **Repo Settings → Pages → Build and deployment**. Set Source to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. Back in Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `<your-username>.github.io`. Without this, admin sign-in fails on the live site.

Your pages will be:
- Judges: `https://<your-username>.github.io/<repo>/`
- Admin: `https://<your-username>.github.io/<repo>/admin.html`

### 6. Lock down sign-ups
Firebase lets anyone create a login through its API by default, even without a sign-up button. Such an account can't do anything, since it isn't in `admins`, but you can turn this off: **Authentication → Settings → User actions**, then uncheck **Enable create (sign-up)**. You can still add admins by hand under **Users**.

### Testing locally
The pages use ES modules, so open them through a local server instead of double-clicking the file:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000. `localhost` is an authorized domain in Firebase by default.

## On the day
1. In **Admin → Setup**, enter the teams, rounds, teams per judge and judge names. Use **Reshuffle** until you're happy with the preview, then click **Publish schedule**.
2. Go to **Judge codes**, click **Copy all** or copy each judge's message, and send every judge the link plus their own code.
3. On the **Scoreboard**, click **Start round 2**, and so on, as the event moves along. Judges can only open the current round and earlier ones.
4. When every ranking is in, the Top 3 stops saying "so far".

Publishing a new schedule clears all rankings and gives every judge a new code, so the page asks you to confirm first.