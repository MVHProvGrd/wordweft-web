// Results rendering module for WordWeft web client
// Extracted from game.js to separate results/post-game concerns from game logic.
const Results = (() => {
    // Module-level context set by show()
    let _players = [];
    let _words = [];
    let _getPlayerColor = () => '#A0A0B8';

    // TTS / Replay state
    let ttsPlaying = false;
    let replayInterval = null;
    let replayIndex = 0;

    // Achievement definitions matching Android
    const ACHIEVEMENTS = {
        first_story:       { icon: '\u{1F4DD}', name: 'First Words',       desc: 'Complete your first story' },
        ten_stories:       { icon: '\u{1F4DA}', name: 'Prolific Author',   desc: 'Complete 10 stories' },
        fifty_stories:     { icon: '\u{1F3C6}', name: 'Literary Legend',   desc: 'Complete 50 stories' },
        first_win:         { icon: '\u{1F947}', name: 'Champion',          desc: 'Win your first game' },
        five_wins:         { icon: '\u2B50',     name: 'Serial Winner',    desc: 'Win 5 games' },
        high_impact:       { icon: '\u{1F4A5}', name: 'Story Shaper',     desc: 'Score 80+ impact in a game' },
        perfect_unique:    { icon: '\u{1F9E0}', name: 'Vocabulary Master', desc: 'Use all unique words in a game' },
        long_word:         { icon: '\u{1F4D6}', name: 'Sesquipedalian',   desc: 'Use a word with 12+ letters' },
        comedy_king:       { icon: '\u{1F602}', name: 'Comedy King',      desc: 'Get a Comedy genre story' },
        horror_master:     { icon: '\u{1F47B}', name: 'Fright Night',     desc: 'Get a Horror genre story' },
        a_plus:            { icon: '\u{1F31F}', name: 'Straight A',       desc: 'Get an A+ grade' },
        poet_title:        { icon: '\u270D\uFE0F', name: 'True Poet',     desc: "Earn 'The Poet' title 3 times" },
        action_hero:       { icon: '\u{1F3AC}', name: 'Action Star',      desc: "Earn 'The Action Hero' title 3 times" },
        hundred_words:     { icon: '\u{1F4AF}', name: 'Centurion',        desc: 'Contribute 100+ total words' },
        five_hundred_words:{ icon: '\u{1F525}', name: 'Word Machine',     desc: 'Contribute 500+ total words' },
        all_genres:        { icon: '\u{1F30D}', name: 'Genre Explorer',   desc: 'Play stories in 5+ genres' }
    };

    const GRADE_ORDER = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F'];
    function betterGrade(a, b) {
        if (!a) return b;
        if (!b) return a;
        return GRADE_ORDER.indexOf(a) <= GRADE_ORDER.indexOf(b) ? a : b;
    }

    function showResults(data, ctx) {
        _players = ctx.players;
        _words = ctx.words;
        _getPlayerColor = ctx.getPlayerColor;

        if (typeof Sound !== 'undefined') { Sound.stopMusic(); Sound.playGameEnd(); }
        App.showScreen('results');

        const gradeChar = (data.storyGrade || 'C').charAt(0);
        const gradeColors = { A: '#10B981', B: '#6366F1', C: '#F59E0B', D: '#EF4444', F: '#EF4444' };
        const gradeColor = gradeColors[gradeChar] || '#F59E0B';

        const illustrationEl = document.getElementById('result-illustration');
        if (illustrationEl) illustrationEl.textContent = data.illustration || '';

        const gradeEl = document.getElementById('result-grade');
        gradeEl.textContent = data.storyGrade || 'C';
        gradeEl.style.cssText = 'font-size:64px;font-weight:900;color:' + gradeColor;
        gradeEl.style.webkitBackgroundClip = '';
        gradeEl.style.webkitTextFillColor = '';
        gradeEl.classList.remove('animate-in');
        requestAnimationFrame(() => gradeEl.classList.add('animate-in'));

        document.getElementById('result-genre').textContent =
            (data.genreDetected || '') + (data.moodDetected ? ' \u2022 ' + data.moodDetected : '');

        const tagsEl = document.getElementById('result-tags');
        if (tagsEl && data.tags && data.tags.length > 0) {
            tagsEl.innerHTML = data.tags.map(t => '<span class="result-tag">' + t + '</span>').join('');
        } else if (tagsEl) {
            tagsEl.innerHTML = '';
        }

        const summaryEl = document.getElementById('result-summary');
        if (summaryEl) {
            summaryEl.textContent = data.summary || '';
            summaryEl.classList.toggle('hidden', !data.summary);
        }

        if (_words.length > 0) {
            renderResultStory(_words.length);
        } else {
            const resultStoryEl = document.getElementById('result-story-text');
            if (resultStoryEl) resultStoryEl.textContent = data.fullStory || '';
        }

        // Score bars
        const scores = [
            { id: 'coherence', value: data.coherenceScore || 0, color: 'score-coherence' },
            { id: 'creativity', value: data.creativityScore || 0, color: 'score-creativity' },
            { id: 'humor', value: data.humorScore || 0, color: 'score-humor' },
            { id: 'vocabulary', value: data.vocabularyScore || 0, color: 'score-vocabulary' },
            { id: 'flow', value: data.flowScore || 0, color: 'score-flow' }
        ];
        scores.forEach((s, i) => {
            const bar = document.getElementById('bar-' + s.id);
            const val = document.getElementById('score-' + s.id);
            const item = bar ? bar.closest('.score-bar-item') : null;
            if (bar) { bar.className = 'score-fill ' + s.color; bar.style.width = '0%'; }
            if (val) val.textContent = '0/100';
            if (item) item.classList.remove('animate-in');
            const delay = 600 + i * 200;
            setTimeout(() => {
                if (item) item.classList.add('animate-in');
                setTimeout(() => {
                    if (bar) bar.style.width = s.value + '%';
                    if (val) {
                        let current = 0;
                        const step = Math.max(1, Math.ceil(s.value / 20));
                        const counter = setInterval(() => {
                            current = Math.min(current + step, s.value);
                            val.textContent = current + '/100';
                            if (current >= s.value) clearInterval(counter);
                        }, 30);
                    }
                }, 100);
            }, delay);
        });

        // Hidden objectives results
        let objectivesData = null;
        const objectivesPromise = Room.ref ? Room.ref.child('objectives').once('value').then(snap => {
            objectivesData = snap.val();
            if (!objectivesData) return;
            const container = document.getElementById('result-objectives');
            if (!container) return;
            container.innerHTML = '<h4 class="result-section-title">Hidden Objectives</h4>';
            container.classList.remove('hidden');
            Object.entries(objectivesData).forEach(([idx, obj]) => {
                const player = _players[parseInt(idx)];
                if (!player || !obj.secretWord) return;
                const word = obj.secretWord || obj.word;
                const succeeded = obj.completed && !obj.busted;
                const status = obj.completed ? (obj.busted ? 'Busted!' : 'Snuck it in!') : 'Failed';
                const cls = succeeded ? 'obj-success' : 'obj-fail';
                const points = succeeded ? '+15' : '-5';
                const pointsCls = succeeded ? 'obj-success' : 'obj-fail';
                const item = document.createElement('div');
                item.className = 'objective-result-item';
                item.innerHTML = '<span class="player-stat-avatar">' + (player.avatar || '\u{1F60A}') + '</span>' +
                    '<span style="flex:1">' + player.name + ': "' + word + '"<br><span class="' + cls + '" style="font-size:12px">' + status + '</span></span>' +
                    '<span class="' + pointsCls + '" style="font-weight:700;font-size:16px">' + points + '</span>';
                container.appendChild(item);
            });
        }) : Promise.resolve();

        const statsArray = data.playerStats ?
            (Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats)) : [];
        statsArray.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));

        objectivesPromise.then(() => {
            renderXPBreakdown(data, statsArray, objectivesData);
            renderPodium(statsArray);
            renderReportCards(data, statsArray);
        });

        if ((data.storyGrade || '').startsWith('A') || (data.storyGrade || '').startsWith('B')) {
            launchConfetti();
        }

        awardXP(data);

        // TTS button
        const readBtn = document.getElementById('btn-read-story');
        if (readBtn) { readBtn.onclick = toggleTTS; readBtn.innerHTML = '&#128264;'; readBtn.title = 'Read Story'; }

        // Share button
        const shareBtn = document.getElementById('btn-copy-story');
        if (shareBtn) {
            shareBtn.innerHTML = '&#128228;'; shareBtn.title = 'Share Story';
            shareBtn.onclick = () => {
                const coloredWords = _words.map(w => {
                    const player = _players.find(p => p.id === w.playerId);
                    return { word: w.word, color: player ? _getPlayerColor(player.color) : '#A0A0B8' };
                });
                const entry = {
                    story: data.fullStory || document.getElementById('result-story-text').textContent,
                    grade: data.storyGrade, genre: data.genreDetected, mood: data.moodDetected,
                    illustration: data.illustration, tags: data.tags,
                    playerNames: _players.map(p => p.name),
                    wordCount: data.totalWords || _words.length, coloredWords: coloredWords
                };
                if (typeof App.shareStory === 'function') App.shareStory(entry, shareBtn);
                else if (typeof Screens !== 'undefined' && Screens.shareStory) Screens.shareStory(entry, shareBtn);
            };
        }

        // Challenge friends button
        const challengeBtn = document.getElementById('btn-challenge-friends');
        if (challengeBtn) {
            challengeBtn.onclick = () => {
                const roomCode = Room.code || '';
                const shareText = 'I just got a ' + (data.storyGrade || '?') + ' on WordWeft! Think you can beat it?\n\n' +
                    (roomCode ? 'Join my room: ' + roomCode + '\n' : '') + 'Play at wordweft.net';
                if (navigator.share) { navigator.share({ text: shareText }).catch(() => {}); }
                else {
                    navigator.clipboard.writeText(shareText);
                    challengeBtn.textContent = 'Copied!';
                    setTimeout(() => { challengeBtn.innerHTML = '<span class="btn-icon">&#9876;&#65039;</span> Challenge Friends'; }, 2000);
                }
            };
        }

        // Auth prompt for anonymous users
        const authPrompt = document.getElementById('result-auth-prompt');
        if (authPrompt) {
            if (typeof Auth !== 'undefined' && Auth.isAnonymous) {
                authPrompt.classList.remove('hidden');
                const signInBtn = document.getElementById('btn-result-google-signin');
                const dismissBtn = document.getElementById('btn-result-auth-dismiss');
                if (signInBtn) signInBtn.onclick = async () => { await Auth.signInWithGoogle(); authPrompt.classList.add('hidden'); };
                if (dismissBtn) dismissBtn.onclick = () => authPrompt.classList.add('hidden');
            } else { authPrompt.classList.add('hidden'); }
        }
    }

    function renderXPBreakdown(data, statsArray, objectivesData) {
        const container = document.getElementById('result-xp-breakdown');
        const list = document.getElementById('xp-breakdown-list');
        if (!container || !list || statsArray.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';
        const maxImpact = Math.max(...statsArray.map(s => s.impactScore || 0));
        const totalWords = data.totalWords || _words.length || 0;
        statsArray.forEach((ps, i) => {
            const isWinner = (ps.impactScore || 0) === maxImpact;
            let xp = 50;
            xp += Math.round((ps.impactScore || 0) / 2);
            const grade = (data.storyGrade || '').charAt(0);
            xp += grade === 'A' ? 40 : grade === 'B' ? 25 : grade === 'C' ? 15 : 5;
            if (isWinner) xp += 30;
            const playerIdx = _players.findIndex(p => p.name === ps.playerName);
            if (objectivesData && objectivesData[playerIdx]) {
                const obj = objectivesData[playerIdx];
                if (obj.completed && !obj.busted) xp += 15; else xp -= 5;
            }
            xp = Math.round(xp * Math.min(1.0, totalWords / 20));
            xp = Math.max(5, xp);
            const level = Math.floor(xp / 100) + 1;
            const row = document.createElement('div');
            row.className = 'xp-row';
            row.innerHTML = '<span class="xp-row-name">' + (ps.playerName || '?') + '</span>' +
                '<span class="xp-row-value">+' + xp + ' XP</span>' +
                '<span class="xp-row-level">Lv.' + level + '</span>';
            list.appendChild(row);
        });
        const xpSection = document.getElementById('xp-earned-section');
        if (xpSection) xpSection.classList.add('hidden');
    }

    function renderPodium(statsArray) {
        const container = document.getElementById('result-podium');
        const display = document.getElementById('podium-display');
        if (!container || !display || statsArray.length < 2) return;
        container.classList.remove('hidden');
        display.innerHTML = '';
        const sorted = [...statsArray].sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
        const podiumOrder = [];
        if (sorted[1]) podiumOrder.push({ ...sorted[1], rank: 2 });
        if (sorted[0]) podiumOrder.push({ ...sorted[0], rank: 1 });
        if (sorted[2]) podiumOrder.push({ ...sorted[2], rank: 3 });
        const heights = { 1: 110, 2: 80, 3: 56 };
        const colors = { 1: '#FBBF24', 2: '#9CA3AF', 3: '#CD7F32' };
        const labels = { 1: '1st', 2: '2nd', 3: '3rd' };
        podiumOrder.forEach((ps, i) => {
            const col = document.createElement('div');
            col.className = 'podium-col';
            const player = _players.find(p => p.name === ps.playerName);
            col.innerHTML =
                '<div class="podium-avatar">' + (ps.playerAvatar || player?.avatar || '\u{1F60A}') + '</div>' +
                '<div class="podium-name" style="color:' + (player ? _getPlayerColor(player.color) : '#fff') + '">' +
                    (ps.playerName || '?') + '</div>' +
                '<div class="podium-score">' + (ps.impactScore || 0) + '</div>' +
                '<div class="podium-bar" style="height:0px;background:' + colors[ps.rank] + ';transition:height 0.5s ease">' +
                    '<span class="podium-rank">' + labels[ps.rank] + '</span></div>';
            display.appendChild(col);
            const delays = [300, 100, 500];
            setTimeout(() => {
                col.classList.add('animate-in');
                col.querySelector('.podium-bar').style.height = heights[ps.rank] + 'px';
            }, 1800 + delays[i]);
        });
    }

    function renderReportCards(data, statsArray) {
        const container = document.getElementById('result-report-cards');
        const list = document.getElementById('report-cards-list');
        if (!container || !list || statsArray.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';
        statsArray.forEach((ps, rank) => {
            const player = _players.find(p => p.name === ps.playerName);
            const card = document.createElement('div');
            card.className = 'report-card';
            const playerColor = player ? _getPlayerColor(player.color) : '#A0A0B8';
            const uniqueRatio = (ps.wordCount || 0) > 0 ? (ps.uniqueWords || 0) / (ps.wordCount || 1) : 0;
            let comment = '';
            if (uniqueRatio >= 1.0) comment = 'Never repeated a word. Every contribution was fresh and unique.';
            else if (uniqueRatio >= 0.9) comment = 'Almost never repeated a word. A remarkably varied vocabulary.';
            else if (uniqueRatio >= 0.7) comment = 'Good variety in word choices with minimal repetition.';
            else comment = 'Contributed steadily to the story with reliable word choices.';
            card.innerHTML =
                '<div class="report-card-header">' +
                    '<span class="report-rank">#' + (rank + 1) + '</span>' +
                    '<span class="player-stat-avatar">' + (ps.playerAvatar || player?.avatar || '\u{1F60A}') + '</span>' +
                    '<div style="flex:1">' +
                        '<div class="player-stat-name" style="color:' + playerColor + '">' + (ps.playerName || '?') + '</div>' +
                        '<div class="player-stat-title">' + (ps.title || '') + '</div>' +
                    '</div>' +
                    '<div class="report-impact">' + (ps.impactScore || 0) + '</div>' +
                '</div>' +
                '<p class="report-comment">' + comment + '</p>' +
                '<div class="report-stats-grid">' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.wordCount || 0) + '</div><div class="report-stat-label">Words</div></div>' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.uniqueWords || ps.wordCount || 0) + '</div><div class="report-stat-label">Unique</div></div>' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.avgWordLength || '0') + '</div><div class="report-stat-label">Avg Len</div></div>' +
                '</div>' +
                '<div class="report-language">' +
                    '<span class="lang-badge">' + (ps.languageLevel || 'A1') + '</span> ' +
                    '<span class="lang-name">' + (ps.languageLevelName || 'Beginner') + '</span>' +
                    (ps.bestWord ? '<span class="report-best">Best word: "' + ps.bestWord + '"</span>' : '') +
                '</div>' +
                (ps.longestWord ? '<div class="report-longest">Longest word: "' + ps.longestWord + '"</div>' : '');
            list.appendChild(card);
        });
    }

    function renderResultStory(upToIndex) {
        const el = document.getElementById('result-story-text');
        if (!el) return;
        el.innerHTML = '';
        const showWords = _words.slice(0, upToIndex);
        const oq = document.createElement('span');
        oq.textContent = '\u201C'; oq.style.color = 'var(--text-muted)'; el.appendChild(oq);
        showWords.forEach((w, i) => {
            const span = document.createElement('span');
            const player = _players.find(p => p.id === w.playerId);
            if (player) span.style.color = _getPlayerColor(player.color);
            else if (w.playerId === -1) { span.style.color = 'var(--text-muted)'; span.style.fontStyle = 'italic'; }
            span.textContent = (i > 0 ? ' ' : '') + w.word;
            if (i === upToIndex - 1 && ttsPlaying) { span.style.textDecoration = 'underline'; span.style.fontWeight = '700'; }
            el.appendChild(span);
        });
        if (ttsPlaying && upToIndex < _words.length) {
            const cursor = document.createElement('span');
            cursor.textContent = ' |'; cursor.style.color = 'var(--accent-indigo)'; cursor.className = 'replay-cursor';
            el.appendChild(cursor);
        }
        if (!ttsPlaying || upToIndex >= _words.length) {
            const cq = document.createElement('span');
            cq.textContent = '\u201D'; cq.style.color = 'var(--text-muted)'; el.appendChild(cq);
        }
    }

    function stopReplay() {
        if (replayInterval) { clearInterval(replayInterval); replayInterval = null; }
        window.speechSynthesis.cancel();
        ttsPlaying = false;
        const btn = document.getElementById('btn-read-story');
        if (btn) btn.innerHTML = '&#128264;';
        renderResultStory(_words.length);
    }

    function toggleTTS() {
        if (ttsPlaying) { stopReplay(); return; }
        if (!_words.length || !('speechSynthesis' in window)) return;
        ttsPlaying = true;
        replayIndex = 0;
        const btn = document.getElementById('btn-read-story');
        if (btn) btn.innerHTML = '&#9209;';
        const text = _words.map(w => w.word).join(' ');
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.9;
        const wordDuration = 400;
        replayInterval = setInterval(() => {
            replayIndex++;
            if (replayIndex > _words.length) { stopReplay(); return; }
            renderResultStory(replayIndex);
        }, wordDuration);
        utt.onend = () => stopReplay();
        window.speechSynthesis.speak(utt);
    }

    async function awardXP(data) {
        if (!Auth.uid) return;
        const allStats = data.playerStats ?
            (Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats)) : [];
        const myStats = allStats.find(ps => ps.playerName === Auth.name);
        if (!myStats) return;

        let xp = 50;
        xp += Math.round((myStats.impactScore || 0) / 2);
        const grade = (data.storyGrade || '').charAt(0);
        xp += grade === 'A' ? 40 : grade === 'B' ? 25 : grade === 'C' ? 15 : 5;
        const maxImpact = Math.max(...allStats.map(s => s.impactScore || 0));
        const isWinner = (myStats.impactScore || 0) === maxImpact;
        if (isWinner) xp += 30;

        try {
            if (Room.ref) {
                const objSnap = await Room.ref.child('objectives/' + Room.myIndex).once('value');
                const obj = objSnap.val();
                if (obj) { if (obj.completed && !obj.busted) xp += 15; else xp -= 5; }
            }
        } catch(e) {}

        const totalWords = data.totalWords || _words.length || 0;
        xp = Math.round(xp * Math.min(1.0, totalWords / 20));
        xp = Math.max(5, xp);

        let streakMultiplier = 1.0;
        try {
            const streakSnap = await db.ref('users/' + Auth.uid + '/stats/currentStreak').once('value');
            const streak = streakSnap.val() || 0;
            if (streak >= 7) streakMultiplier = 1.5;
            else if (streak >= 3) streakMultiplier = 1.25;
            else if (streak >= 2) streakMultiplier = 1.1;
        } catch(e) {}
        const baseXp = xp;
        xp = Math.round(xp * streakMultiplier);

        try {
            const statsRef = db.ref('users/' + Auth.uid + '/stats');
            const snap = await statsRef.once('value');
            const current = snap.val() || {};
            const newStats = {
                totalXp: (current.totalXp || 0) + xp,
                gamesPlayed: (current.gamesPlayed || 0) + 1,
                gamesWon: (current.gamesWon || 0) + (isWinner ? 1 : 0),
                totalWordsWritten: (current.totalWordsWritten || 0) + (myStats.wordCount || 0),
                totalScore: (current.totalScore || 0) + (myStats.impactScore || 0),
                bestGrade: betterGrade(current.bestGrade, data.storyGrade),
                currentStreak: (current.currentStreak || 0) + 1,
                lastPlayed: firebase.database.ServerValue.TIMESTAMP
            };
            await statsRef.update(newStats);
            const lbEntry = { xp: newStats.totalXp, displayName: Auth.name, avatar: Auth.avatar };
            await db.ref('leaderboard/allTime/' + Auth.uid).set(lbEntry);
            await db.ref('leaderboard/weekly/' + Auth.uid).set(lbEntry);

            const xpSection = document.getElementById('xp-earned-section');
            const xpText = document.getElementById('xp-earned-text');
            if (xpSection && xpText) {
                xpSection.classList.remove('hidden');
                const streakText = streakMultiplier > 1.0 ? ' (' + Math.round((streakMultiplier - 1) * 100) + '% streak bonus!)' : '';
                xpText.textContent = '+' + xp + ' XP earned!' + streakText;
            }

            if (typeof Screens !== 'undefined' && Screens.checkAchievements) {
                Screens.checkAchievements(data, newStats, myStats);
            } else if (typeof App !== 'undefined' && App.checkAchievements) {
                App.checkAchievements(data, newStats, myStats);
            }

            showAchievementProgress(newStats, data, myStats);
            showHighlights(data, myStats, allStats);

            if (typeof Screens !== 'undefined' && Screens.saveStory) {
                Screens.saveStory(data);
            } else if (typeof App !== 'undefined' && App.saveStory) {
                App.saveStory(data);
            }

            // Track friends
            try {
                const maxImpactVal = Math.max(...allStats.map(s => s.impactScore || 0));
                const myWon = (myStats.impactScore || 0) === maxImpactVal;
                for (const p of _players) {
                    if (!p.uid || p.uid === Auth.uid) continue;
                    const friendRef = db.ref('users/' + Auth.uid + '/friends/' + p.uid);
                    const fSnap = await friendRef.once('value');
                    const existing = fSnap.val() || {};
                    await friendRef.update({
                        name: p.name, avatar: p.avatar || '',
                        gamesTogether: (existing.gamesTogether || 0) + 1,
                        wins: (existing.wins || 0) + (myWon ? 1 : 0),
                        losses: (existing.losses || 0) + (myWon ? 0 : 1),
                        lastPlayed: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            } catch (e) {}
        } catch (e) { console.error('Failed to award XP:', e); }
    }

    async function showAchievementProgress(stats, data, myStats) {
        const container = document.getElementById('result-ach-progress');
        const list = document.getElementById('ach-progress-list');
        if (!container || !list || !Auth.uid) return;
        let unlocked = {};
        try {
            const snap = await db.ref('users/' + Auth.uid + '/achievements').once('value');
            unlocked = snap.val() || {};
        } catch(e) { return; }
        const hints = [];
        const games = stats.gamesPlayed || 0;
        const wins = stats.gamesWon || 0;
        const wordsTotal = stats.totalWordsWritten || 0;
        if (!unlocked.ten_stories?.unlocked && games >= 5)
            hints.push({ icon: '\u{1F4DA}', name: 'Prolific Author', remaining: (10 - games) + ' more games' });
        if (!unlocked.fifty_stories?.unlocked && games >= 30)
            hints.push({ icon: '\u{1F3C6}', name: 'Literary Legend', remaining: (50 - games) + ' more games' });
        if (!unlocked.five_wins?.unlocked && wins >= 2)
            hints.push({ icon: '\u2B50', name: 'Serial Winner', remaining: (5 - wins) + ' more wins' });
        if (!unlocked.hundred_words?.unlocked && wordsTotal >= 50)
            hints.push({ icon: '\u{1F4AF}', name: 'Centurion', remaining: (100 - wordsTotal) + ' more words' });
        if (!unlocked.five_hundred_words?.unlocked && wordsTotal >= 300)
            hints.push({ icon: '\u{1F525}', name: 'Word Machine', remaining: (500 - wordsTotal) + ' more words' });
        if (hints.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';
        hints.slice(0, 3).forEach(h => {
            const item = document.createElement('div');
            item.className = 'ach-progress-item';
            item.innerHTML =
                '<span class="ach-progress-icon">' + h.icon + '</span>' +
                '<div class="ach-progress-info"><div class="ach-progress-name">' + h.name + '</div></div>' +
                '<span class="ach-progress-remaining">' + h.remaining + '</span>';
            list.appendChild(item);
        });
    }

    function showHighlights(data, myStats, allStats) {
        const container = document.getElementById('result-highlights');
        const list = document.getElementById('highlights-list');
        if (!container || !list) return;
        const highlights = [];
        let longestWord = '', longestPlayer = '';
        allStats.forEach(ps => {
            if (ps.longestWord && ps.longestWord.length > longestWord.length) {
                longestWord = ps.longestWord; longestPlayer = ps.playerName || '';
            }
        });
        if (longestWord.length >= 6) highlights.push({ icon: '\u{1F4D6}', text: 'Longest word by ' + longestPlayer, value: '"' + longestWord + '"' });
        let bestWord = '', bestPlayer = '', bestLevel = '';
        allStats.forEach(ps => {
            if (ps.bestWord) { bestWord = ps.bestWord; bestPlayer = ps.playerName || ''; bestLevel = ps.bestWordLevel || ''; }
        });
        if (bestWord) highlights.push({ icon: '\u{1F48E}', text: 'Rarest word by ' + bestPlayer, value: '"' + bestWord + '" (' + bestLevel + ')' });
        let mostUnique = 0, uniquePlayer = '';
        allStats.forEach(ps => {
            const ratio = (ps.wordCount || 0) > 0 ? (ps.uniqueWords || 0) / (ps.wordCount || 1) : 0;
            if (ratio > mostUnique && (ps.wordCount || 0) >= 3) { mostUnique = ratio; uniquePlayer = ps.playerName || ''; }
        });
        if (mostUnique >= 0.8 && uniquePlayer) highlights.push({ icon: '\u{1F9E0}', text: 'Most unique vocabulary', value: uniquePlayer + ' (' + Math.round(mostUnique * 100) + '%)' });
        if (allStats.length >= 2) {
            const top = allStats.reduce((a, b) => (b.impactScore || 0) > (a.impactScore || 0) ? b : a);
            if (top.impactScore >= 50) highlights.push({ icon: '\u{1F451}', text: 'MVP', value: (top.playerName || '?') + ' (' + top.impactScore + ')' });
        }
        if (highlights.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';
        highlights.forEach(h => {
            const item = document.createElement('div');
            item.className = 'highlight-item';
            item.innerHTML =
                '<span class="highlight-icon">' + h.icon + '</span>' +
                '<span class="highlight-text">' + h.text + '</span>' +
                '<span class="highlight-value">' + h.value + '</span>';
            list.appendChild(item);
        });
    }

    function launchConfetti() {
        const container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);
        const colors = ['#FFD700','#6366F1','#10B981','#EF4444','#8B5CF6','#F59E0B','#EC4899','#06B6D4'];
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'confetti-particle';
            particle.style.backgroundColor = colors[i % colors.length];
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = (Math.random() * 0.5) + 's';
            particle.style.animationDuration = (1.5 + Math.random()) + 's';
            particle.style.setProperty('--sway', (Math.random() * 60 - 30) + 'px');
            container.appendChild(particle);
        }
        setTimeout(() => container.remove(), 3500);
    }

    return {
        show: showResults,
        ACHIEVEMENTS,
        launchConfetti,
        betterGrade
    };
})();
