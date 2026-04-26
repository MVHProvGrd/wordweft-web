// Authentication module for WordWeft web client
const Auth = (() => {
    let currentUser = null;
    let playerName = '';
    let playerAvatar = '';
    let onAuthReady = null;

    const AVATARS = [
        '\u{1F60A}', '\u{1F920}', '\u{1F916}', '\u{1F431}',
        '\u{1F432}', '\u{1F9D9}', '\u{1F680}', '\u{1F31F}',
        '\u{1F33B}', '\u{1F3B5}', '\u{1F525}', '\u{1F98B}',
        '\u26A1', '\u{1F308}', '\u{1F48E}', '\u{1F355}'
    ];

    // Player colors matching Android app
    const PLAYER_COLORS = [
        0xFFFF6B6B, 0xFF4ECDC4, 0xFF45B7D1, 0xFF96CEB4,
        0xFFFFEAA7, 0xFFDDA0DD, 0xFF98D8C8, 0xFFF7DC6F
    ];

    function init() {
        return new Promise((resolve) => {
            onAuthReady = resolve;
            auth.onAuthStateChanged((user) => {
                currentUser = user;
                loadLocalProfile();
                updateUI();
                rewireBlockedListener();
                checkBannedAndBoot();
                if (onAuthReady) {
                    onAuthReady(user);
                    onAuthReady = null;
                }
            });
        });
    }

    async function ensureSignedIn() {
        if (currentUser) return currentUser;
        try {
            const result = await auth.signInAnonymously();
            return result.user;
        } catch (e) {
            console.error('Anonymous sign-in failed:', e);
            return null;
        }
    }

    async function signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            if (currentUser && currentUser.isAnonymous) {
                const anonUid = currentUser.uid;
                try {
                    const result = await currentUser.linkWithPopup(provider);
                    currentUser = result.user;
                } catch (e) {
                    // The picked Google account already has a Firebase user.
                    // Sign into the existing account, then merge the anonymous
                    // data into it (mirrors Android collision flow).
                    if (e.code === 'auth/credential-already-in-use' ||
                        e.code === 'auth/email-already-in-use') {
                        const cred = e.credential ||
                            (firebase.auth.GoogleAuthProvider.credentialFromError &&
                                firebase.auth.GoogleAuthProvider.credentialFromError(e));
                        let newUser;
                        if (cred) {
                            const r = await auth.signInWithCredential(cred);
                            newUser = r.user;
                        } else {
                            const r = await auth.signInWithPopup(provider);
                            newUser = r.user;
                        }
                        if (newUser && newUser.uid !== anonUid) {
                            await mergeAnonymousIntoCurrent(anonUid, newUser.uid);
                        }
                        currentUser = newUser;
                    } else {
                        throw e;
                    }
                }
            } else {
                const result = await auth.signInWithPopup(provider);
                currentUser = result.user;
            }
            updateUI();
            return currentUser;
        } catch (e) {
            console.error('Google sign-in failed:', e);
            return null;
        }
    }

    /**
     * Merge an anonymous Firebase user's data into an existing (Google-linked)
     * user record. Same rules as Android UserRepository.mergeAnonymousIntoCurrent:
     *  - Profile / dayStreak / lastSignInDay / currentWinStreak / currentTitle:
     *    NOT merged (destination keeps its identity / streak state).
     *  - Counters: summed.
     *  - Best stats: take the better of the two.
     *  - Averages: weighted by gamesPlayed.
     *  - History / stories: concat, trim to 50 most recent.
     *  - Friends: union with summed counters.
     *  - Achievements: union; keep earliest unlock.
     *  - Genre history: union.
     *
     * As of 2026-04-24 this ships a thin wrapper around the
     * `mergeAnonymousAccount` Cloud Function so the merge runs with
     * admin privileges (enables tightening users/{uid}/.write to
     * auth.uid === $uid). If the callable fails for any reason we
     * log — we do NOT fall back to a client-side merge since that
     * would silently keep writing to other users' nodes and mask
     * the rule violation.
     */
    async function mergeAnonymousIntoCurrent(fromUid, toUid) {
        if (!fromUid || !toUid || fromUid === toUid) return;
        try {
            if (!firebase.functions) {
                console.error('mergeAnonymousIntoCurrent: firebase.functions not loaded');
                return;
            }
            const callable = firebase.functions().httpsCallable('mergeAnonymousAccount');
            const res = await callable({ anonUid: fromUid });
            console.log('Merged anonymous user', fromUid, 'into', toUid,
                '(server):', res && res.data);
        } catch (e) {
            console.error('mergeAnonymousAccount callable failed:', e && (e.code + ' ' + e.message));
        }
    }

    /**
     * Legacy client-side merge kept UNUSED — retained only so older
     * callers that reference the symbol still compile. All real merges
     * now go through the `mergeAnonymousAccount` Cloud Function (see
     * mergeAnonymousIntoCurrent above). Delete in a follow-up once the
     * entire session proves the server path sticks.
     */
    async function _legacyMergeAnonymousIntoCurrent(fromUid, toUid) {
        if (!fromUid || !toUid || fromUid === toUid) return;
        try {
            const srcRef = db.ref('users/' + fromUid);
            const [stsSnap, histSnap, friendsSnap, achSnap, storiesSnap] = await Promise.all([
                srcRef.child('stats').once('value'),
                srcRef.child('history').once('value'),
                srcRef.child('friends').once('value'),
                srcRef.child('achievements').once('value'),
                srcRef.child('stories').once('value'),
            ]);
            const stats = stsSnap.val() || {};

            // Stats: sum / max / weighted average via transaction
            await db.ref('users/' + toUid + '/stats').transaction(d => {
                d = d || {};
                const srcGames = stats.gamesPlayed || 0;
                const newGames = (d.gamesPlayed || 0) + srcGames;
                const curGames = d.gamesPlayed || 0;
                const curAvgImpact = d.averageImpactScore || 0;
                const curAvgRarity = d.averageWordRarity || 1.0;
                d.gamesPlayed = newGames;
                d.gamesWon = (d.gamesWon || 0) + (stats.gamesWon || 0);
                d.totalXp = (d.totalXp || 0) + (stats.totalXp || 0);
                d.totalWordsContributed = (d.totalWordsContributed || 0) + (stats.totalWordsContributed || 0);
                d.totalWordsWritten = (d.totalWordsWritten || 0) + (stats.totalWordsWritten || 0);
                d.totalUniqueWords = (d.totalUniqueWords || 0) + (stats.totalUniqueWords || 0);
                d.bestImpactScore = Math.max(d.bestImpactScore || 0, stats.bestImpactScore || 0);
                const sl = stats.longestWord || '';
                const cl = d.longestWord || '';
                if (sl.length > cl.length) d.longestWord = sl;
                if (newGames > 0) {
                    d.averageImpactScore = ((curAvgImpact * curGames) + ((stats.averageImpactScore || 0) * srcGames)) / newGames;
                    d.averageWordRarity = ((curAvgRarity * curGames) + ((stats.averageWordRarity || 1.0) * srcGames)) / newGames;
                }
                const levels = ['A1','A2','B1','B2','C1','C2'];
                if (levels.indexOf(stats.bestLanguageLevel || 'A1') > levels.indexOf(d.bestLanguageLevel || 'A1')) {
                    d.bestLanguageLevel = stats.bestLanguageLevel;
                }
                const grades = ['F','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+'];
                if (grades.indexOf(stats.bestStoryGrade || '') > grades.indexOf(d.bestStoryGrade || '')) {
                    d.bestStoryGrade = stats.bestStoryGrade;
                }
                return d;
            });

            // History: concat with new push keys, then trim to 50 most recent
            if (histSnap.exists()) {
                const updates = {};
                histSnap.forEach(child => {
                    const newKey = db.ref('users/' + toUid + '/history').push().key;
                    updates[newKey] = child.val();
                });
                await db.ref('users/' + toUid + '/history').update(updates);
                const trimSnap = await db.ref('users/' + toUid + '/history').once('value');
                const entries = [];
                trimSnap.forEach(c => entries.push({ key: c.key, ts: (c.child('timestamp').val() || 0) }));
                if (entries.length > 50) {
                    entries.sort((a, b) => a.ts - b.ts);
                    const del = {};
                    entries.slice(0, entries.length - 50).forEach(e => { del[e.key] = null; });
                    await db.ref('users/' + toUid + '/history').update(del);
                }
            }

            // Friends: union with summed counters
            if (friendsSnap.exists()) {
                const promises = [];
                friendsSnap.forEach(src => {
                    const fUid = src.key;
                    const f = src.val() || {};
                    promises.push(db.ref('users/' + toUid + '/friends/' + fUid).transaction(d => {
                        d = d || {};
                        if (!d.displayName) d.displayName = f.displayName || '';
                        d.gamesTogether = (d.gamesTogether || 0) + (f.gamesTogether || 0);
                        d.myWins = (d.myWins || 0) + (f.myWins || 0);
                        d.theirWins = (d.theirWins || 0) + (f.theirWins || 0);
                        d.gamesPlayedTogether = (d.gamesPlayedTogether || 0) + (f.gamesPlayedTogether || 0);
                        d.wins = (d.wins || 0) + (f.wins || 0);
                        d.losses = (d.losses || 0) + (f.losses || 0);
                        d.lastPlayed = Math.max(d.lastPlayed || 0, f.lastPlayed || 0);
                        return d;
                    }));
                });
                await Promise.all(promises);
            }

            // Achievements: union, keep earliest unlock; genreHistory: union
            if (achSnap.exists()) {
                const tasks = [];
                achSnap.forEach(child => {
                    if (child.key === 'genreHistory') return;
                    const v = child.val();
                    if (v && v.unlocked) {
                        tasks.push(db.ref('users/' + toUid + '/achievements/' + child.key).transaction(d => {
                            if (!d || !d.unlocked) return v;
                            const curAt = d.unlockedAt || Number.MAX_SAFE_INTEGER;
                            if ((v.unlockedAt || 0) > 0 && v.unlockedAt < curAt) {
                                return Object.assign({}, d, { unlockedAt: v.unlockedAt });
                            }
                            return d;
                        }));
                    }
                });
                await Promise.all(tasks);

                const srcGenres = achSnap.child('genreHistory').val();
                if (Array.isArray(srcGenres) && srcGenres.length > 0) {
                    const ghRef = db.ref('users/' + toUid + '/achievements/genreHistory');
                    const cur = (await ghRef.once('value')).val() || [];
                    await ghRef.set(Array.from(new Set([...cur, ...srcGenres])));
                }
            }

            // Stories: concat, trim to 50 most recent
            if (storiesSnap.exists()) {
                const updates = {};
                storiesSnap.forEach(c => { updates[c.key] = c.val(); });
                await db.ref('users/' + toUid + '/stories').update(updates);
                const trimSnap = await db.ref('users/' + toUid + '/stories').once('value');
                const keys = [];
                trimSnap.forEach(c => keys.push(c.key));
                if (keys.length > 50) {
                    const del = {};
                    keys.slice(0, keys.length - 50).forEach(k => { del[k] = null; });
                    await db.ref('users/' + toUid + '/stories').update(del);
                }
            }

            // Push a leaderboard entry so the merged user appears immediately
            // (without this they'd be invisible until they played another game).
            try {
                const profSnap = await db.ref('users/' + toUid + '/profile').once('value');
                const prof = profSnap.val() || {};
                const finalStatsSnap = await db.ref('users/' + toUid + '/stats').once('value');
                const finalStats = finalStatsSnap.val() || {};
                const xp = finalStats.totalXp || 0;
                const displayName = prof.displayName || playerName || '';
                if (displayName) {
                    const lvl = (typeof calculateLevel === 'function') ? calculateLevel(xp) : 0;
                    const rnk = (typeof getRank === 'function') ? getRank(lvl) : '';
                    await db.ref('leaderboard/allTime/' + toUid).set({
                        xp: xp,
                        totalXp: xp,
                        displayName: displayName,
                        avatar: prof.avatar || '',
                        level: lvl,
                        rank: rnk,
                        gamesPlayed: finalStats.gamesPlayed || 0,
                        gamesWon: finalStats.gamesWon || 0
                    });
                }
            } catch (e) { /* non-fatal */ }

            // Drop the abandoned anonymous user's subtree
            await srcRef.remove();
            console.log('Merged anonymous user', fromUid, 'into', toUid);
        } catch (e) {
            console.error('Failed to merge anonymous data:', e);
        }
    }

    function loadLocalProfile() {
        playerName = localStorage.getItem('wordweft_name') || '';
        playerAvatar = localStorage.getItem('wordweft_avatar') || '';
    }

    function saveLocalProfile(name, avatar) {
        playerName = name;
        playerAvatar = avatar;
        localStorage.setItem('wordweft_name', name);
        localStorage.setItem('wordweft_avatar', avatar);
    }

    function updateUI() {
        const userBar = document.getElementById('user-bar');
        if (currentUser && playerName) {
            if (userBar) userBar.classList.remove('hidden');
            const avatarEl = document.getElementById('user-avatar');
            if (avatarEl) avatarEl.textContent = playerAvatar || '\u{1F60A}';
            const nameEl = document.getElementById('user-name');
            if (nameEl) nameEl.textContent = playerName;
            loadUserLevel();
        } else {
            if (userBar) userBar.classList.add('hidden');
        }
        showDailyChallenge();
    }

    // YYYY-MM-DD in the user's local timezone.
    function localDateKey(d) {
        const t = d || new Date();
        return t.getFullYear() + '-' +
            String(t.getMonth() + 1).padStart(2, '0') + '-' +
            String(t.getDate()).padStart(2, '0');
    }

    // Tick the day-streak: +1 if last sign-in was yesterday, hold if today, reset to 1 otherwise.
    // Returns the resolved dayStreak. Tied to the signed-in account, not games played.
    async function tickDayStreak(stats) {
        if (!currentUser) return 0;
        // Anonymous accounts don't earn a day-streak — it's tied to a real
        // signed-in identity. They get one once they link/sign-in to Google.
        if (currentUser.isAnonymous) return 0;
        const today = localDateKey();
        const yesterday = localDateKey(new Date(Date.now() - 86400000));
        const last = stats.lastSignInDay || '';
        let dayStreak;
        if (last === today) {
            dayStreak = stats.dayStreak || 1;
        } else if (last === yesterday) {
            dayStreak = (stats.dayStreak || 0) + 1;
        } else {
            dayStreak = 1;
        }
        if (last !== today) {
            try {
                await db.ref('users/' + currentUser.uid + '/stats').update({
                    dayStreak: dayStreak,
                    lastSignInDay: today
                });
            } catch (e) { /* non-fatal */ }
        }
        return dayStreak;
    }

    async function loadUserLevel() {
        if (!currentUser) return;
        try {
            const snap = await db.ref('users/' + currentUser.uid + '/stats').once('value');
            const stats = snap.val() || {};
            const xp = stats.totalXp || 0;
            const level = calculateLevel(xp);
            const rank = getRank(level);
            const currentLevelXp = xp - xpForLevel(level);
            const nextLevelXp = xpForLevel(level + 1) - xpForLevel(level);
            const progress = nextLevelXp > 0 ? (currentLevelXp / nextLevelXp * 100) : 0;

            const levelEl = document.getElementById('user-level');
            if (levelEl) levelEl.textContent = 'Lv.' + level + ' ' + rank;
            const xpBar = document.getElementById('xp-bar');
            if (xpBar) xpBar.style.width = progress + '%';
            const xpText = document.getElementById('xp-text');
            if (xpText) xpText.textContent = xp + ' XP';

            // Day-streak banner — calendar-day based, ticked on sign-in.
            const dayStreak = await tickDayStreak(stats);
            const streakBanner = document.getElementById('streak-banner');
            const streakCount = document.getElementById('streak-count');
            if (streakBanner && streakCount) {
                if (dayStreak >= 2) {
                    streakCount.textContent = dayStreak;
                    streakBanner.classList.remove('hidden');
                } else {
                    streakBanner.classList.add('hidden');
                }
            }
        } catch (e) {
            console.error('Failed to load user level:', e);
        }
    }

    function showDailyChallenge() {
        const el = document.getElementById('daily-challenge');
        const textEl = document.getElementById('daily-challenge-text');
        if (!el || !textEl) return;

        const challenges = [
            'Write a horror story',
            'Use only 1-word turns',
            'Try to get an A+ grade',
            'Use the word "magnificent" in your story',
            'Write a love story',
            'Use 5-word turns for extra creativity',
            'Write a comedy — make it funny!',
            'Try to use the longest words you can',
            'Write a mystery story with a twist',
            'Use at least 3 adjectives in your turns',
            'Write a sci-fi adventure',
            'Challenge: no repeating words!',
            'Write a story set in the future',
            'Tell a story from an animal\'s perspective',
        ];
        const today = new Date();
        const dayIndex = (today.getFullYear() * 366 + today.getMonth() * 31 + today.getDate()) % challenges.length;
        textEl.textContent = challenges[dayIndex];
        el.classList.remove('hidden');
    }

    function calculateLevel(xp) {
        let lvl = 0;
        while (xpForLevel(lvl + 1) <= xp) lvl++;
        return lvl;
    }

    function xpForLevel(level) {
        if (level <= 0) return 0;
        if (level <= 5) return level * 100;
        if (level <= 10) return 500 + (level - 5) * 200;
        if (level <= 20) return 1500 + (level - 10) * 350;
        return 5000 + (level - 20) * 500;
    }

    function getRank(level) {
        if (level >= 50) return 'Legendary Author';
        if (level >= 40) return 'Master Wordsmith';
        if (level >= 30) return 'Epic Storyteller';
        if (level >= 20) return 'Seasoned Writer';
        if (level >= 15) return 'Published Author';
        if (level >= 10) return 'Aspiring Novelist';
        if (level >= 7) return 'Story Weaver';
        if (level >= 5) return 'Word Crafter';
        if (level >= 3) return 'Apprentice';
        if (level >= 1) return 'Newcomer';
        return 'Unranked';
    }

    // Save profile to Firebase
    async function saveProfileToFirebase() {
        if (!currentUser || !playerName) return;
        try {
            await db.ref('users/' + currentUser.uid + '/profile').update({
                displayName: playerName,
                avatar: playerAvatar,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                platform: 'web'
            });
            // Set createdAt if first time
            const snap = await db.ref('users/' + currentUser.uid + '/profile/createdAt').once('value');
            if (!snap.exists()) {
                await db.ref('users/' + currentUser.uid + '/profile/createdAt')
                    .set(firebase.database.ServerValue.TIMESTAMP);
            }
            // If the user has an existing leaderboard entry, patch its
            // displayName/avatar so the global board shows their latest
            // identity without waiting for another game result.
            if (!currentUser.isAnonymous) {
                const lbRef = db.ref('leaderboard/allTime/' + currentUser.uid);
                const lbSnap = await lbRef.child('displayName').once('value');
                if (lbSnap.exists()) {
                    await lbRef.update({ displayName: playerName, avatar: playerAvatar });
                }
                const wkRef = db.ref('leaderboard/weekly/' + currentUser.uid);
                const wkSnap = await wkRef.child('displayName').once('value');
                if (wkSnap.exists()) {
                    await wkRef.update({ displayName: playerName, avatar: playerAvatar });
                }
            }
        } catch (e) {
            console.error('Failed to save profile:', e);
        }
    }

    async function signOut() {
        try {
            await auth.signOut();
            localStorage.removeItem('wordweft_name');
            localStorage.removeItem('wordweft_avatar');
            localStorage.removeItem('wordweft_color');
            localStorage.removeItem('wordweft_music');
            playerName = '';
            playerAvatar = '';
            currentUser = null;
            updateUI();
            // Re-sign in anonymously so the app still works
            await ensureSignedIn();
        } catch (e) {
            console.error('Sign out failed:', e);
        }
    }

    /* ── Moderation ─────────────────────────────────────────────── */

    // Module-level caches so callers can synchronously check
    // `Auth.blockedUids.has(uid)` / `Auth.blockedByUids.has(uid)`
    // (matchmaking filter, friend tracking, friends-list display)
    // without firing a fresh RTDB read each time. Kept current by
    // internal listeners wired on auth-state change; fanned out to
    // external observe* subscribers.
    let blockedUidsSet = new Set();
    let blockedByUidsSet = new Set();
    const blockedSubscribers = new Set();
    const blockedBySubscribers = new Set();
    let blockedRef = null;
    let blockedCb = null;
    let blockedByRef = null;
    let blockedByCb = null;
    function rewireBlockedListener() {
        if (blockedRef && blockedCb) {
            blockedRef.off('value', blockedCb);
            blockedRef = null;
            blockedCb = null;
        }
        if (blockedByRef && blockedByCb) {
            blockedByRef.off('value', blockedByCb);
            blockedByRef = null;
            blockedByCb = null;
        }
        blockedUidsSet = new Set();
        blockedByUidsSet = new Set();
        if (!auth.currentUser) {
            blockedSubscribers.forEach((fn) => { try { fn([]); } catch (_) {} });
            blockedBySubscribers.forEach((fn) => { try { fn([]); } catch (_) {} });
            return;
        }
        blockedRef = db.ref(`users/${auth.currentUser.uid}/blocked`);
        blockedCb = blockedRef.on('value', (snap) => {
            blockedUidsSet = new Set(Object.keys(snap.val() || {}));
            const arr = Array.from(blockedUidsSet);
            blockedSubscribers.forEach((fn) => { try { fn(arr); } catch (_) {} });
        });
        // blockedBy is admin-write-only (mirrorBlock CF) and owner-read-
        // only. Reverse-direction matchmaking unions blocked + blockedBy
        // so a blocked user can't see the blocker's public rooms either.
        blockedByRef = db.ref(`blockedBy/${auth.currentUser.uid}`);
        blockedByCb = blockedByRef.on('value', (snap) => {
            blockedByUidsSet = new Set(Object.keys(snap.val() || {}));
            const arr = Array.from(blockedByUidsSet);
            blockedBySubscribers.forEach((fn) => { try { fn(arr); } catch (_) {} });
        });
    }
    function observeBlockedByUids(onChange) {
        blockedBySubscribers.add(onChange);
        try { onChange(Array.from(blockedByUidsSet)); } catch (_) {}
        return () => { blockedBySubscribers.delete(onChange); };
    }

    async function blockUser(blockedUid) {
        if (!auth.currentUser || !blockedUid) return false;
        try {
            await db.ref(`users/${auth.currentUser.uid}/blocked/${blockedUid}`).set(true);
            return true;
        } catch (e) { console.error('blockUser failed:', e); return false; }
    }
    async function unblockUser(blockedUid) {
        if (!auth.currentUser || !blockedUid) return false;
        try {
            await db.ref(`users/${auth.currentUser.uid}/blocked/${blockedUid}`).remove();
            return true;
        } catch (e) { console.error('unblockUser failed:', e); return false; }
    }
    async function getBlockedUids() {
        if (!auth.currentUser) return [];
        try {
            const snap = await db.ref(`users/${auth.currentUser.uid}/blocked`).once('value');
            const val = snap.val() || {};
            return Object.keys(val);
        } catch (e) { return []; }
    }
    /** Attach a live listener. Returns a teardown function. */
    function observeBlockedUids(onChange) {
        blockedSubscribers.add(onChange);
        // Fire once with current value so subscribers don't have to wait
        // for the next RTDB push.
        try { onChange(Array.from(blockedUidsSet)); } catch (_) {}
        return () => { blockedSubscribers.delete(onChange); };
    }
    /** One-shot banned check on auth-state change. If the current user
     *  has a `bannedUsers/{uid}` entry the page is replaced with a
     *  suspension notice and the session is signed out so the banned
     *  account can't continue using the app from this tab. */
    let bannedNoticeShown = false;
    async function checkBannedAndBoot() {
        if (!auth.currentUser || bannedNoticeShown) return;
        try {
            const snap = await db.ref(`bannedUsers/${auth.currentUser.uid}`).once('value');
            const v = snap.val();
            if (!v) return;
            bannedNoticeShown = true;
            const reason = (typeof v === 'object' && v.reason) ? v.reason : 'Terms-of-service violation.';
            try { await auth.signOut(); } catch (_) {}
            // Replace the entire body so no in-flight UI keeps running.
            document.body.innerHTML =
                '<div style="font-family:system-ui;color:#EEE6FF;background:linear-gradient(180deg,#160B2E,#1E1238);' +
                'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;">' +
                '<div style="max-width:520px;background:#291847;border:1px solid rgba(232,111,90,0.5);border-radius:18px;padding:28px 26px;">' +
                '<h1 style="margin:0 0 8px;color:#E86F5A;font-size:24px;">Account suspended</h1>' +
                '<p style="margin:0 0 12px;color:#C7B8E8;font-size:14px;line-height:1.55;">' +
                'Your WordWeft account has been suspended for violating our community ' +
                'guidelines.</p>' +
                '<p style="margin:0 0 16px;color:#8D7FAE;font-size:12px;font-family:monospace;">' +
                'Reason: ' + String(reason).replace(/[<>&]/g, '') + '</p>' +
                '<p style="margin:0;color:#8D7FAE;font-size:12px;">' +
                'If you believe this is a mistake, email <a href="mailto:wordweftgame@gmail.com" ' +
                'style="color:#B8A8FF;">wordweftgame@gmail.com</a>.</p>' +
                '</div></div>';
        } catch (e) { /* read denied for non-bannees by rule, treat as not-banned */ }
    }

    async function fileReport({ reportedUid, roomId, content, reason = 'other', details }) {
        if (!auth.currentUser || !reportedUid) return false;
        try {
            const payload = {
                reporter: auth.currentUser.uid,
                reportedUser: reportedUid,
                reason,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
            };
            if (roomId) payload.roomId = roomId;
            if (content) payload.content = String(content).slice(0, 500);
            if (details) payload.details = String(details).slice(0, 1000);
            await db.ref('reports').push().set(payload);
            return true;
        } catch (e) { console.error('fileReport failed:', e); return false; }
    }

    /**
     * Delete the current Firebase Auth account. Fires the server-side
     * onUserDelete Cloud Function which scrubs the user's RTDB nodes.
     * Returns one of 'success' | 'requires-reauth' | 'no-user' | 'failed'.
     * Anonymous accounts delete immediately; Google-linked accounts may
     * throw auth/requires-recent-login.
     */
    async function deleteAccount() {
        if (!auth.currentUser) return 'no-user';
        try {
            await auth.currentUser.delete();
            // Clear local mirror of the profile.
            localStorage.removeItem('wordweft_name');
            localStorage.removeItem('wordweft_avatar');
            localStorage.removeItem('wordweft_color');
            localStorage.removeItem('wefty_run_history');
            playerName = '';
            playerAvatar = '';
            currentUser = null;
            updateUI();
            // Re-sign in anonymously so a subsequent session has an identity.
            await ensureSignedIn();
            return 'success';
        } catch (e) {
            if (e && e.code === 'auth/requires-recent-login') {
                console.warn('deleteAccount: requires recent re-auth');
                return 'requires-reauth';
            }
            console.error('deleteAccount failed:', e);
            return 'failed';
        }
    }

    return {
        init,
        ensureSignedIn,
        signInWithGoogle,
        signOut,
        deleteAccount,
        blockUser,
        unblockUser,
        getBlockedUids,
        observeBlockedUids,
        observeBlockedByUids,
        fileReport,
        saveLocalProfile,
        saveProfileToFirebase,
        updateUI,
        get uid() { return currentUser ? currentUser.uid : null; },
        get user() { return currentUser; },
        get name() { return playerName; },
        get avatar() { return playerAvatar; },
        get blockedUids() { return blockedUidsSet; },
        get blockedByUids() { return blockedByUidsSet; },
        get isSignedIn() { return !!currentUser; },
        get isAnonymous() { return currentUser ? currentUser.isAnonymous : true; },
        AVATARS,
        PLAYER_COLORS,
        calculateLevel,
        xpForLevel,
        getRank
    };
})();
