// Screen-specific rendering modules for WordWeft web client
// Extracted from app.js to separate screen concerns from core app logic.
const Screens = (() => {

    function gradeColor(grade) {
        const g = (grade || '').charAt(0);
        if (g === 'A') return '#10B981';
        if (g === 'B') return '#6366F1';
        if (g === 'C') return '#F59E0B';
        return '#EF4444';
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxHeight) {
        const words = text.split(' ');
        let line = '';
        let currentY = y;
        for (let i = 0; i < words.length; i++) {
            const test = line + words[i] + ' ';
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line.trim(), x, currentY);
                line = words[i] + ' ';
                currentY += lineHeight;
                if (currentY - y > maxHeight) {
                    ctx.fillText('...', x, currentY);
                    return;
                }
            } else {
                line = test;
            }
        }
        if (line.trim()) ctx.fillText(line.trim(), x, currentY);
    }

    function wrapColoredText(ctx, coloredWords, x, y, maxWidth, lineHeight, maxHeight) {
        let currentX = x;
        let currentY = y;
        // Opening quote
        ctx.fillStyle = '#6B7280';
        ctx.fillText('\u201C', currentX, currentY);
        currentX += ctx.measureText('\u201C').width;

        for (let i = 0; i < coloredWords.length; i++) {
            const w = coloredWords[i];
            const text = (i > 0 ? ' ' : '') + w.word;
            const width = ctx.measureText(text).width;
            if (currentX + width > x + maxWidth && i > 0) {
                currentX = x;
                currentY += lineHeight;
                if (currentY - y > maxHeight) {
                    ctx.fillStyle = '#6B7280';
                    ctx.fillText('...', currentX, currentY);
                    return;
                }
            }
            ctx.fillStyle = w.color;
            ctx.fillText(text, currentX, currentY);
            currentX += width;
        }
        // Closing quote
        ctx.fillStyle = '#6B7280';
        ctx.fillText('\u201D', currentX, currentY);
    }

    async function generateStoryCard(entry) {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#13111C';
        ctx.fillRect(0, 0, 1080, 1920);

        // Subtle border
        ctx.strokeStyle = 'rgba(99,102,241,0.3)';
        ctx.lineWidth = 4;
        ctx.roundRect(20, 20, 1040, 1880, 40);
        ctx.stroke();

        // Title
        ctx.fillStyle = '#8B5CF6';
        ctx.font = 'bold 48px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('WordWeft', 540, 100);

        // Illustration
        if (entry.illustration) {
            ctx.font = '100px system-ui';
            ctx.fillText(entry.illustration, 540, 230);
        }

        // Grade
        ctx.fillStyle = gradeColor(entry.grade);
        ctx.font = 'bold 180px system-ui';
        ctx.fillText(entry.grade || 'C', 540, entry.illustration ? 430 : 350);

        // Genre + mood
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '36px system-ui';
        const genreMood = (entry.genre || '') + (entry.mood ? ' \u2022 ' + entry.mood : '');
        ctx.fillText(genreMood, 540, entry.illustration ? 490 : 410);

        // Tags
        const tags = entry.tags || [];
        if (tags.length > 0) {
            ctx.font = '28px system-ui';
            ctx.fillStyle = '#6366F1';
            ctx.fillText(tags.join('  \u2022  '), 540, entry.illustration ? 540 : 460);
        }

        // Story text
        const storyY = entry.illustration ? 620 : 540;
        ctx.font = '32px system-ui';
        ctx.textAlign = 'left';
        if (entry.coloredWords && entry.coloredWords.length > 0) {
            wrapColoredText(ctx, entry.coloredWords, 80, storyY, 920, 44, 800);
        } else {
            ctx.fillStyle = '#E5E7EB';
            wrapText(ctx, '\u201C' + (entry.story || '') + '\u201D', 80, storyY, 920, 44, 800);
        }

        // Players
        ctx.fillStyle = '#6B7280';
        ctx.font = '28px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText((entry.playerNames || []).join('  \u2022  '), 540, 1780);

        // Word count
        ctx.font = '24px system-ui';
        ctx.fillText((entry.wordCount || 0) + ' words', 540, 1820);

        // Watermark
        ctx.fillStyle = '#4B5563';
        ctx.font = '24px system-ui';
        ctx.fillText('wordweft.net', 540, 1870);

        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    async function shareStory(entry, btn) {
        const shareText = 'WordWeft Story (Grade: ' + (entry.grade || '?') + ')\n\n' +
            '\u201C' + (entry.story || '') + '\u201D\n\n' +
            'Genre: ' + (entry.genre || 'Unknown') + ' | Mood: ' + (entry.mood || 'Unknown') + '\n' +
            'Players: ' + (entry.playerNames || []).join(', ');

        try {
            const blob = await generateStoryCard(entry);
            if (navigator.share && blob) {
                const file = new File([blob], 'wordweft-story.png', { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ text: shareText, files: [file] });
                    return;
                }
            }
            if (navigator.share) {
                await navigator.share({ text: shareText });
                return;
            }
        } catch (e) {
            if (e.name === 'AbortError') return; // user cancelled
        }

        // Fallback: clipboard
        navigator.clipboard.writeText(shareText);
        if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
        }
    }

    async function loadLeaderboard(tab) {
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        try {
            const path = tab === 'weekly' ? 'leaderboard/weekly' : 'leaderboard/allTime';
            const snap = await db.ref(path).orderByChild('xp').limitToLast(50).once('value');
            const entries = [];
            snap.forEach(child => {
                entries.push({ uid: child.key, ...child.val() });
            });
            entries.sort((a, b) => (b.xp || 0) - (a.xp || 0));

            if (entries.length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No players yet. Play a game to get on the board!</div>';
                return;
            }

            list.innerHTML = '';
            // Load detailed stats for each user
            const statsPromises = entries.map(e =>
                db.ref('users/' + e.uid + '/stats').once('value').then(s => s.val()).catch(() => null)
            );
            const allStats = await Promise.all(statsPromises);

            entries.forEach((entry, i) => {
                const stats = allStats[i] || {};
                const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
                const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '#' + (i + 1);
                const isMe = entry.uid === Auth.uid;
                const level = Auth.calculateLevel(entry.xp || 0);
                const wins = stats.gamesWon || 0;
                const games = stats.gamesPlayed || 0;
                const losses = games - wins;
                const words = stats.totalWordsWritten || 0;
                const div = document.createElement('div');
                div.className = 'lb-entry' + (isMe ? ' me' : '') + (i < 3 ? ' top3' : '');
                const avgImpact = stats.avgImpactScore ? Math.round(stats.avgImpactScore) : '';
                const favTitle = entry.favoriteTitle || '';
                div.innerHTML =
                    '<div class="lb-rank ' + rankClass + '">' + medal + '</div>' +
                    '<div class="lb-avatar">' + (entry.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="lb-info">' +
                        '<div class="lb-name">' + (entry.displayName || 'Anonymous') + '</div>' +
                        (favTitle ? '<div class="lb-favorite-title">' + favTitle + '</div>' : '') +
                        '<div class="lb-level">Lv.' + level + ' ' + Auth.getRank(level) + '</div>' +
                        '<div class="lb-stats">' + wins + 'W ' + losses + 'L \u2022 ' + words + ' words' +
                            (avgImpact ? ' \u2022 ' + avgImpact + ' avg impact' : '') + '</div>' +
                    '</div>' +
                    '<div class="lb-xp">' + (entry.xp || 0) + '<br><span class="lb-xp-label">XP</span></div>';
                list.appendChild(div);
            });
        } catch (e) {
            console.error('Failed to load leaderboard:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load leaderboard</div>';
        }
    }

    // --- Achievements ---
    async function checkAchievements(data, stats, myStats) {
        const uid = Auth.uid;
        if (!uid) return;

        try {
            const achRef = db.ref('users/' + uid + '/achievements');
            const achSnap = await achRef.once('value');
            const existing = achSnap.val() || {};
            const newlyUnlocked = [];

            function tryUnlock(id) {
                if (existing[id] && existing[id].unlocked) return;
                achRef.child(id).set({ unlocked: true, unlockedAt: firebase.database.ServerValue.TIMESTAMP });
                newlyUnlocked.push(id);
            }

            // Count-based achievements
            if (stats.gamesPlayed >= 1) tryUnlock('first_story');
            if (stats.gamesPlayed >= 10) tryUnlock('ten_stories');
            if (stats.gamesPlayed >= 50) tryUnlock('fifty_stories');
            if (stats.gamesWon >= 1) tryUnlock('first_win');
            if (stats.gamesWon >= 5) tryUnlock('five_wins');
            if (stats.totalWordsWritten >= 100) tryUnlock('hundred_words');
            if (stats.totalWordsWritten >= 500) tryUnlock('five_hundred_words');

            // Per-game achievements
            if (myStats && (myStats.impactScore || 0) >= 80) tryUnlock('high_impact');
            if (myStats && myStats.uniqueWords === myStats.wordCount && myStats.wordCount > 3) tryUnlock('perfect_unique');
            if (myStats && myStats.longestWord && myStats.longestWord.replace(/[^a-z]/gi,'').length >= 12) tryUnlock('long_word');
            if (data.storyGrade === 'A+') tryUnlock('a_plus');
            if ((data.genreDetected || '').toLowerCase().includes('comedy')) tryUnlock('comedy_king');
            if ((data.genreDetected || '').toLowerCase().includes('horror')) tryUnlock('horror_master');
            if (myStats && myStats.title === 'The Poet') tryUnlock('poet_title');
            if (myStats && myStats.title === 'The Action Hero') tryUnlock('action_hero');

            // Genre tracking for all_genres
            const genre = (data.genreDetected || '').toLowerCase();
            if (genre) {
                const ghRef = db.ref('users/' + uid + '/achievements/genreHistory');
                const ghSnap = await ghRef.once('value');
                const genres = ghSnap.val() || [];
                if (!genres.includes(genre)) {
                    genres.push(genre);
                    await ghRef.set(genres);
                }
                if (genres.length >= 5) tryUnlock('all_genres');
            }

            // Show toast for each new unlock
            const ACHS = Game.ACHIEVEMENTS;
            newlyUnlocked.forEach((id, i) => {
                setTimeout(() => {
                    const toast = document.getElementById('achievement-toast');
                    if (!toast || !ACHS[id]) return;
                    toast.textContent = ACHS[id].icon + ' ' + ACHS[id].name + ' Unlocked!';
                    toast.classList.remove('hidden');
                    toast.style.animation = 'none';
                    toast.offsetHeight;
                    toast.style.animation = '';
                    setTimeout(() => toast.classList.add('hidden'), 3000);
                }, i * 3200);
            });
        } catch (e) {
            console.error('Achievement check failed:', e);
        }
    }

    async function loadAchievements() {
        const grid = document.getElementById('achievements-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const uid = Auth.uid;
        let unlocked = {};
        if (uid) {
            try {
                const snap = await db.ref('users/' + uid + '/achievements').once('value');
                unlocked = snap.val() || {};
            } catch (e) {}
        }

        const ACHS = Game.ACHIEVEMENTS;
        const totalCount = Object.keys(ACHS).length;
        const unlockedCount = Object.keys(unlocked).filter(k => unlocked[k] && unlocked[k].unlocked).length;
        const progressEl = document.getElementById('achievements-progress');
        if (progressEl) {
            const pct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
            progressEl.innerHTML =
                '<div class="ach-progress-text">' + unlockedCount + ' / ' + totalCount + ' unlocked</div>' +
                '<div class="ach-progress-bar"><div class="ach-progress-fill" style="width:' + pct + '%"></div></div>';
        }

        Object.entries(ACHS).forEach(([id, ach]) => {
            const isUnlocked = unlocked[id] && unlocked[id].unlocked;
            const card = document.createElement('div');
            card.className = 'achievement-card' + (isUnlocked ? '' : ' locked');
            let dateStr = '';
            if (isUnlocked && unlocked[id].unlockedAt) {
                dateStr = '<div class="ach-date">Unlocked ' + new Date(unlocked[id].unlockedAt).toLocaleDateString() + '</div>';
            }
            card.innerHTML =
                (isUnlocked ? '<span class="ach-check">\u2713</span>' : '') +
                '<div class="ach-icon">' + (isUnlocked ? ach.icon : '\u{1F512}') + '</div>' +
                '<div class="ach-name">' + ach.name + '</div>' +
                '<div class="ach-desc">' + ach.desc + '</div>' +
                dateStr;
            grid.appendChild(card);
        });
    }

    // --- Story History ---
    async function saveStory(data) {
        const uid = Auth.uid;
        if (!uid) return;
        try {
            const timestamp = Date.now();
            const entry = {
                story: data.fullStory || '',
                grade: data.storyGrade || 'C',
                genre: data.genreDetected || '',
                mood: data.moodDetected || '',
                playerNames: (Game.players || []).map(p => p.name),
                wordCount: data.totalWords || 0,
                timestamp: timestamp,
                tags: data.tags || [],
                illustration: data.illustration || ''
            };
            const histRef = db.ref('users/' + uid + '/stories');
            await histRef.child(String(timestamp)).set(entry);

            // Enforce 50-story limit
            const snap = await histRef.orderByKey().once('value');
            const keys = [];
            snap.forEach(child => keys.push(child.key));
            if (keys.length > 50) {
                const deletes = {};
                keys.slice(0, keys.length - 50).forEach(k => { deletes[k] = null; });
                await histRef.update(deletes);
            }
        } catch (e) {
            console.error('Failed to save story:', e);
        }
    }

    async function loadHistory() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        const uid = Auth.uid;
        if (!uid) {
            list.innerHTML = '<div class="leaderboard-empty">Sign in to see your stories</div>';
            return;
        }

        try {
            const snap = await db.ref('users/' + uid + '/stories')
                .orderByKey().limitToLast(50).once('value');
            const entries = [];
            snap.forEach(child => { entries.push({ key: child.key, ...child.val() }); });
            entries.reverse();

            if (entries.length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No stories yet. Play a game!</div>';
                return;
            }

            list.innerHTML = '';
            entries.forEach(entry => {
                const div = document.createElement('div');
                div.className = 'history-entry';
                const preview = (entry.story || '').substring(0, 80) + ((entry.story || '').length > 80 ? '...' : '');
                const date = new Date(entry.timestamp).toLocaleDateString();
                const playerCount = (entry.playerNames || []).length;

                let tagsHtml = '';
                if (entry.genre) tagsHtml += '<span class="history-tag">' + entry.genre + '</span>';
                if (entry.mood) tagsHtml += '<span class="history-tag">' + entry.mood + '</span>';

                const illustration = entry.illustration || '';
                div.innerHTML =
                    '<div class="history-header">' +
                        (illustration ? '<span class="history-illustration">' + illustration + '</span>' : '') +
                        '<span class="history-grade-badge" style="color:' + gradeColor(entry.grade) + '">' + (entry.grade || '?') + '</span>' +
                        '<div class="history-meta">' + date + ' &bull; ' + playerCount + ' players &bull; ' + (entry.wordCount || 0) + ' words</div>' +
                    '</div>' +
                    '<div class="history-preview">' + preview + '</div>' +
                    (tagsHtml ? '<div class="history-tags">' + tagsHtml + '</div>' : '') +
                    '<div class="history-actions">' +
                        '<button class="btn btn-small btn-ghost btn-share-story">Share</button>' +
                        '<button class="btn btn-small btn-ghost btn-delete-story" style="color:var(--accent-red)">Delete</button>' +
                    '</div>';

                // Bind share
                div.querySelector('.btn-share-story').addEventListener('click', () => {
                    shareStory(entry, div.querySelector('.btn-share-story'));
                });

                // Bind delete
                div.querySelector('.btn-delete-story').addEventListener('click', async () => {
                    await db.ref('users/' + uid + '/stories/' + entry.key).remove();
                    div.remove();
                    if (list.children.length === 0) {
                        list.innerHTML = '<div class="leaderboard-empty">No stories yet. Play a game!</div>';
                    }
                });

                list.appendChild(div);
            });
        } catch (e) {
            console.error('Failed to load history:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load stories</div>';
        }
    }

    // --- Friends ---
    async function loadFriends() {
        const uid = Auth.uid;
        const card = document.getElementById('my-level-card');
        const list = document.getElementById('friends-list');

        // My level card
        if (card && uid) {
            try {
                const snap = await db.ref('users/' + uid + '/stats').once('value');
                const stats = snap.val() || {};
                const xp = stats.totalXp || 0;
                const level = Auth.calculateLevel(xp);
                card.innerHTML = '<div class="my-level-avatar">' + (Auth.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="my-level-name">' + (Auth.name || 'You') + '</div>' +
                    '<div class="my-level-rank">Lv.' + level + ' ' + Auth.getRank(level) + '</div>';
            } catch (e) { card.innerHTML = ''; }
        }

        if (!list || !uid) return;
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        try {
            const snap = await db.ref('users/' + uid + '/friends').once('value');
            const friends = snap.val();
            if (!friends || Object.keys(friends).length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No friends yet. Play games with others to see them here!</div>';
                return;
            }

            list.innerHTML = '';
            const entries = Object.entries(friends).sort((a, b) => (b[1].gamesTogether || 0) - (a[1].gamesTogether || 0));
            for (const [fuid, fdata] of entries) {
                // Load friend's profile
                let profile = {};
                try {
                    const pSnap = await db.ref('users/' + fuid + '/profile').once('value');
                    profile = pSnap.val() || {};
                } catch (e) {}
                let fStats = {};
                try {
                    const sSnap = await db.ref('users/' + fuid + '/stats').once('value');
                    fStats = sSnap.val() || {};
                } catch (e) {}

                const fLevel = Auth.calculateLevel(fStats.totalXp || 0);
                const wins = fdata.wins || 0;
                const losses = fdata.losses || 0;
                const games = fdata.gamesTogether || 0;

                const div = document.createElement('div');
                div.className = 'friend-entry';
                const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
                const bestGrade = fdata.bestGrade || '';
                div.innerHTML =
                    '<div class="friend-avatar">' + (profile.avatar || fdata.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="friend-info">' +
                        '<div class="friend-name">' + (profile.displayName || fdata.name || 'Player') + '</div>' +
                        '<div class="friend-level">Lv.' + fLevel + ' ' + Auth.getRank(fLevel) + '</div>' +
                        '<div class="friend-games">' + games + ' games \u2022 ' + winRate + '% win rate' +
                            (bestGrade ? ' \u2022 Best: ' + bestGrade : '') + '</div>' +
                    '</div>' +
                    '<div class="friend-record">' +
                        '<div class="friend-wl"><span class="friend-wins">' + wins + 'W</span> - <span class="friend-losses">' + losses + 'L</span></div>' +
                        '<div class="friend-wl-label">Head-to-Head</div>' +
                    '</div>';
                list.appendChild(div);
            }
        } catch (e) {
            console.error('Failed to load friends:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load friends</div>';
        }
    }

    return {
        loadLeaderboard,
        loadAchievements,
        loadHistory,
        loadFriends,
        checkAchievements,
        saveStory,
        shareStory,
        gradeColor,
        generateStoryCard
    };
})();
