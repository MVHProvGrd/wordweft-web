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
        const googleBtn = document.getElementById('btn-google-signin');
        const authStatus = document.getElementById('auth-status');

        if (currentUser && playerName) {
            userBar.classList.remove('hidden');
            document.getElementById('user-avatar').textContent = playerAvatar || '\u{1F60A}';
            document.getElementById('user-name').textContent = playerName;
            // Load level info from Firebase
            loadUserLevel();
        } else {
            userBar.classList.add('hidden');
        }

        const signOutBtn = document.getElementById('btn-sign-out');

        if (currentUser && !currentUser.isAnonymous) {
            googleBtn.classList.add('hidden');
            if (signOutBtn) signOutBtn.classList.remove('hidden');
            authStatus.textContent = 'Signed in as ' + (currentUser.email || currentUser.displayName);
        } else if (currentUser) {
            googleBtn.classList.remove('hidden');
            if (signOutBtn) signOutBtn.classList.add('hidden');
            authStatus.textContent = 'Playing as guest';
        }
    }

    async function loadUserLevel() {
        if (!currentUser) return;
        try {
            const snap = await db.ref('users/' + currentUser.uid + '/stats').once('value');
            const stats = snap.val();
            if (stats) {
                const xp = stats.totalXp || 0;
                const level = calculateLevel(xp);
                const rank = getRank(level);
                const currentLevelXp = xp - xpForLevel(level);
                const nextLevelXp = xpForLevel(level + 1) - xpForLevel(level);
                const progress = nextLevelXp > 0 ? (currentLevelXp / nextLevelXp * 100) : 0;

                document.getElementById('user-level').textContent = 'Lv.' + level + ' ' + rank;
                document.getElementById('xp-bar').style.width = progress + '%';
                document.getElementById('xp-text').textContent = xp + ' XP';
            }
        } catch (e) {
            console.error('Failed to load user level:', e);
        }
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
