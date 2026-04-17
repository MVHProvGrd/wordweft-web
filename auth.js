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
                // Link anonymous account to Google
                const result = await currentUser.linkWithPopup(provider);
                currentUser = result.user;
            } else {
                const result = await auth.signInWithPopup(provider);
                currentUser = result.user;
            }
            updateUI();
            return currentUser;
        } catch (e) {
            // If linking fails because account already exists, sign in directly
            if (e.code === 'auth/credential-already-in-use') {
                try {
                    const result = await auth.signInWithPopup(provider);
                    currentUser = result.user;
                    updateUI();
                    return currentUser;
                } catch (e2) {
                    console.error('Google sign-in fallback failed:', e2);
                }
            }
            console.error('Google sign-in failed:', e);
            return null;
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
            userBar.classList.remove('hidden');
            document.getElementById('user-avatar').textContent = playerAvatar || '\u{1F60A}';
            document.getElementById('user-name').textContent = playerName;
            loadUserLevel();
            showDailyChallenge();
        } else {
            if (userBar) userBar.classList.add('hidden');
        }
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

            document.getElementById('user-level').textContent = 'Lv.' + level + ' ' + rank;
            document.getElementById('xp-bar').style.width = progress + '%';
            document.getElementById('xp-text').textContent = xp + ' XP';

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

    return {
        init,
        ensureSignedIn,
        signInWithGoogle,
        signOut,
        saveLocalProfile,
        saveProfileToFirebase,
        updateUI,
        get uid() { return currentUser ? currentUser.uid : null; },
        get user() { return currentUser; },
        get name() { return playerName; },
        get avatar() { return playerAvatar; },
        get isSignedIn() { return !!currentUser; },
        get isAnonymous() { return currentUser ? currentUser.isAnonymous : true; },
        AVATARS,
        PLAYER_COLORS,
        calculateLevel,
        xpForLevel,
        getRank
    };
})();
